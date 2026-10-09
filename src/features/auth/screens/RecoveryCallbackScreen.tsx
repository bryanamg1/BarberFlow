import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ErrorState, LoadingState } from '@/components/ui';
import { RecoveryLayout } from '../components/RecoveryLayout';
import { RecoveryRequestForm } from '../components/RecoveryRequestForm';
import { authService } from '../services/authService';

export function RecoveryCallbackScreen() {
  const { code } = useLocalSearchParams<{ code?: string | string[] }>();
  const validCode = typeof code === 'string' && code.length > 0;
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let disposed = false;
    if (typeof code !== 'string' || !code) return;
    void authService.completePasswordRecovery({ code }).then(
      (result) => {
        if (!disposed) setFailed(!!result.error);
      },
      () => {
        if (!disposed) setFailed(true);
      },
    );
    return () => {
      disposed = true;
    };
  }, [code]);
  return (
    <RecoveryLayout title="Recuperar contraseña">
      {!validCode || failed ? (
        <>
          <ErrorState
            title="No se pudo verificar el enlace"
            message="El enlace no es válido o ya venció. Solicita nuevas instrucciones."
          />
          <RecoveryRequestForm />
        </>
      ) : (
        <LoadingState message="Verificando enlace…" />
      )}
    </RecoveryLayout>
  );
}
