import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import { SupabaseService } from '../database/supabase.service';

@Injectable()
export class FirebaseService implements OnModuleInit {
  private readonly logger = new Logger(FirebaseService.name);
  private messaging: admin.messaging.Messaging | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly supabase: SupabaseService,
  ) {}

  onModuleInit() {
    const credentialsJson = this.configService.get<string>(
      'FIREBASE_CREDENTIALS',
    );

    if (!credentialsJson) {
      this.logger.warn(
        'FIREBASE_CREDENTIALS not set, push notifications will be unavailable',
      );
      return;
    }

    try {
      const credentials = JSON.parse(credentialsJson);

      if (!admin.apps.length) {
        admin.initializeApp({
          credential: admin.credential.cert(credentials),
        });
      }

      this.messaging = admin.messaging();
      this.logger.log('Firebase Admin initialized');
    } catch (error) {
      this.logger.error(`Failed to initialize Firebase Admin: ${error}`);
    }
  }

  /**
   * Send a push notification to all of a user's registered devices.
   *
   * Looks up device tokens from the `device_tokens` table in Supabase,
   * sends the notification via FCM, and removes any tokens that FCM
   * reports as invalid.
   */
  async sendPushNotification(
    userId: string,
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<void> {
    if (!this.messaging) {
      this.logger.warn(
        'Skipping push notification: Firebase not initialized',
      );
      return;
    }

    const { data: tokenRows, error } = await this.supabase.client
      .from('device_tokens')
      .select('fcm_token')
      .eq('user_id', userId);

    if (error) {
      this.logger.error(
        `Failed to fetch device tokens for user ${userId}: ${error.message}`,
      );
      return;
    }

    if (!tokenRows || tokenRows.length === 0) {
      this.logger.debug(`No device tokens found for user ${userId}`);
      return;
    }

    const tokens = tokenRows.map((row) => row.fcm_token as string);

    const message: admin.messaging.MulticastMessage = {
      tokens,
      notification: { title, body },
      ...(data && { data }),
    };

    try {
      const response = await this.messaging.sendEachForMulticast(message);

      if (response.failureCount > 0) {
        const invalidTokens: string[] = [];

        response.responses.forEach((resp, index) => {
          if (resp.error) {
            const code = resp.error.code;

            if (
              code === 'messaging/invalid-registration-token' ||
              code === 'messaging/registration-token-not-registered'
            ) {
              invalidTokens.push(tokens[index]);
            } else {
              this.logger.error(
                `FCM error for token ${tokens[index]}: ${resp.error.message}`,
              );
            }
          }
        });

        if (invalidTokens.length > 0) {
          this.logger.log(
            `Removing ${invalidTokens.length} invalid token(s) for user ${userId}`,
          );

          const { error: deleteError } = await this.supabase.client
            .from('device_tokens')
            .delete()
            .in('fcm_token', invalidTokens);

          if (deleteError) {
            this.logger.error(
              `Failed to remove invalid tokens: ${deleteError.message}`,
            );
          }
        }
      }

      this.logger.debug(
        `Push notification sent to user ${userId}: ${response.successCount}/${tokens.length} succeeded`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to send push notification to user ${userId}: ${error}`,
      );
    }
  }
}
