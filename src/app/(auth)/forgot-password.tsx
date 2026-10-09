import { RecoveryLayout } from '@/features/auth/components/RecoveryLayout';
import { RecoveryRequestForm } from '@/features/auth/components/RecoveryRequestForm';

export default function ForgotPasswordRoute() {
  return (
    <RecoveryLayout
      title="Recuperar contraseña"
      description="Ingresa tu correo y te enviaremos instrucciones para continuar."
    >
      <RecoveryRequestForm />
    </RecoveryLayout>
  );
}
