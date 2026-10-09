import { RecoveryLayout } from '@/features/auth/components/RecoveryLayout';
import { ResetPasswordForm } from '@/features/auth/components/ResetPasswordForm';

export default function ResetPasswordRoute() {
  return (
    <RecoveryLayout title="Nueva contraseña">
      <ResetPasswordForm />
    </RecoveryLayout>
  );
}
