import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { testSmtpWithEmail, testGmailWithEmail, testResendWithEmail } from "./emailTestUtils.js";

export const onEmailConnectionTestCreate = onDocumentWritten("Settings/emailTestingConnection", async (event) => {
    const change = event.data;
    if (!change || !change.after.exists) return; // Document deleted

    const data = change.after.data();
    if (!data || data['status'] !== 'processing') return; // Prevent infinite loop on update

    const { config, activeProvider, testEmail, subject, message } = data;

    const docRef = change.after.ref;

    try {
        let result;
        switch (activeProvider) {
            case 'smtp':
                result = await testSmtpWithEmail(config, testEmail, subject, message);
                break;
            case 'gmail':
                result = await testGmailWithEmail(config, testEmail, subject, message);
                break;
            case 'resend':
                result = await testResendWithEmail(config, testEmail, subject, message);
                break;
            default:
                throw new Error(`Unsupported provider: ${activeProvider}`);
        }

        await docRef.update({
            status: result.success ? 'success' : 'failed',
            message: result.message,
            updatedAt: new Date()
        });
    } catch (error: any) {
        console.error(`Connection Test Error for ${activeProvider}:`, error);
        await docRef.update({
            status: 'failed',
            message: error.message || `Failed to establish ${activeProvider} connection`,
            error: error.message || 'Unknown error',
            updatedAt: new Date()
        });
    }
});
