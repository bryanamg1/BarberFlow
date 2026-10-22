import { uuid } from 'expo-modules-core';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Badge, Button, Card, EmptyState, ErrorState, Input, LoadingState } from '@/components/ui';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { useServiceList } from '@/features/services/hooks/useServiceList';
import { servicesKeys } from '@/features/services/constants/servicesKeys';
import { theme } from '@/theme';
import { formatCatalogPrice, formatMoney } from '@/utils/formatMoney';

import { useCheckoutServiceItems } from '../hooks/useCheckoutServiceItems';
import { checkoutDraftStore, type CheckoutScope } from '../store/checkoutDraftStore';
import { addCheckoutService } from '../utils/checkoutServiceItems';

export type CheckoutServiceEligibility = {
  scope: CheckoutScope | null;
  operationId: string | null;
  eligible: boolean;
};
export function CheckoutServiceItems({
  onEligibilityChange,
}: {
  onEligibilityChange?: (value: CheckoutServiceEligibility) => void;
}) {
  const model = useCheckoutServiceItems();
  const queryClient = useQueryClient();
  const business = useBusiness();
  const pageIdentity = JSON.stringify([model.scope, model.draft?.operationId]);
  const [pagination, setPagination] = useState({ identity: pageIdentity, page: 1 });
  const page = pagination.identity === pageIdentity ? pagination.page : 1;
  const setPage = (change: (value: number) => number) =>
    setPagination({ identity: pageIdentity, page: change(page) });
  const list = useServiceList({ page, pageSize: 25, status: 'active' });
  const userId = model.scope?.userId;
  const businessId = model.scope?.businessId;
  const membershipId = model.scope?.membershipId;
  const operationId = model.draft?.operationId;
  const eligibilityCallback = useRef(onEligibilityChange);
  useEffect(() => {
    eligibilityCallback.current = onEligibilityChange;
  }, [onEligibilityChange]);
  useEffect(() => {
    eligibilityCallback.current?.({
      scope: userId && businessId && membershipId ? { userId, businessId, membershipId } : null,
      operationId: operationId ?? null,
      eligible: model.eligible,
    });
  }, [userId, businessId, membershipId, operationId, model.eligible]);
  if (!model.scope || !model.draft || business.status !== 'success')
    return <EmptyState title="No hay una intención de checkout activa" />;
  const { scope, draft } = model;
  const currency = business.data.business.currency_code;
  const choices =
    list.status === 'success'
      ? list.data.items.filter(
          (service) => service.is_active && service.business_id === scope.businessId,
        )
      : [];
  return (
    <View style={styles.section}>
      <Text role="heading" style={styles.heading}>
        Servicios del checkout
      </Text>
      <Text style={styles.hint}>
        Precios estimados. El servidor confirma los importes al cobrar.
      </Text>
      {model.rows.length === 0 && <Text style={styles.text}>Sin servicios seleccionados</Text>}
      {model.rows.map((row, index) => (
        <ServiceLine
          key={`${draft.operationId}:${row.line.lineId}`}
          row={row}
          index={index}
          currency={currency}
          locked={model.locked}
          onQuantity={(text) => model.editLine(row.line.lineId, 'quantity', text)}
          onOverride={(text) => model.editLine(row.line.lineId, 'override', text)}
          onClearOverride={() => model.clearOverride(row.line.lineId)}
          onRetry={() => {
            void queryClient.invalidateQueries({
              queryKey: servicesKeys.detail(scope.businessId, row.line.itemId),
            });
          }}
          onRemove={() =>
            checkoutDraftStore.getState().removeLine(scope, draft.operationId, row.line.lineId)
          }
        />
      ))}
      {list.status === 'pending' ? (
        <LoadingState message="Cargando servicios…" />
      ) : list.status === 'error' ? (
        <ErrorState
          message={list.error.message}
          retrying={list.isFetching}
          onRetry={() => {
            void queryClient.invalidateQueries({
              queryKey: servicesKeys.list(scope.businessId, {
                page,
                pageSize: 25,
                status: 'active',
              }),
            });
          }}
        />
      ) : list.status === 'success' ? (
        <>
          {choices.length === 0 && <EmptyState title="No hay servicios activos para seleccionar" />}
          {choices.map((service) => (
            <Card key={service.id} style={styles.section}>
              <Text style={styles.text}>{service.name}</Text>
              <Text style={styles.hint}>{formatCatalogPrice(service.price, currency)}</Text>
              <Button
                label="Agregar"
                accessibilityLabel={`Agregar servicio: ${service.name}`}
                disabled={model.locked || list.isFetching}
                onPress={() => {
                  addCheckoutService(scope, draft.operationId, uuid.v4(), service);
                }}
              />
            </Card>
          ))}
          <View style={styles.controls}>
            <Button
              label="Anterior"
              variant="secondary"
              disabled={page <= 1 || list.isFetching}
              onPress={() => setPage((value) => value - 1)}
            />
            <Text role="status" style={styles.text}>
              Página {page}
            </Text>
            <Button
              label="Siguiente"
              variant="secondary"
              disabled={!list.data.hasNextPage || list.isFetching}
              onPress={() => setPage((value) => value + 1)}
            />
          </View>
        </>
      ) : (
        <EmptyState title="Catálogo no disponible" />
      )}
      <Text role="status" aria-live="polite" style={styles.hint}>
        {model.eligible
          ? 'Servicios listos para revisión'
          : 'Revisa los servicios antes de continuar'}
      </Text>
    </View>
  );
}

type Model = ReturnType<typeof useCheckoutServiceItems>;
function ServiceLine({
  row,
  index,
  currency,
  locked,
  onQuantity,
  onOverride,
  onClearOverride,
  onRemove,
  onRetry,
}: {
  row: Model['rows'][number];
  index: number;
  currency: string;
  locked: boolean;
  onQuantity: (text: string) => void;
  onOverride: (text: string) => void;
  onClearOverride: () => void;
  onRemove: () => void;
  onRetry: () => void;
}) {
  const previousPrice = useRef(row.service?.price);
  const [priceChanged, setPriceChanged] = useState(false);
  useEffect(() => {
    if (row.status !== 'ready' || !row.service) return;
    if (previousPrice.current !== undefined && previousPrice.current !== row.service.price)
      setPriceChanged(true);
    previousPrice.current = row.service.price;
  }, [row.service, row.status]);
  const label = `línea ${index + 1}`;
  return (
    <Card style={styles.section}>
      <Text style={styles.text}>
        Servicio ({label}): {row.service?.name ?? 'No disponible'}
      </Text>
      {row.status === 'loading' ? (
        <LoadingState message="Consultando servicio seleccionado…" />
      ) : row.status === 'error' ? (
        <ErrorState
          message="No se pudo consultar el servicio. Se conserva la selección."
          retryLabel={`Reintentar servicio de ${label}`}
          onRetry={onRetry}
          retryDisabled={locked}
        />
      ) : row.status === 'unavailable' ? (
        <>
          <Badge label="No disponible" />
          <Text style={styles.hint}>
            Se conserva la línea. Quita o revisa esta referencia antes de continuar.
          </Text>
        </>
      ) : null}
      {priceChanged && (
        <Text role="status" style={styles.hint}>
          Precio de catálogo actualizado; revisa la estimación. Tu override se conserva.
        </Text>
      )}
      {row.status === 'ready' && row.service && (
        <Text style={styles.hint}>
          Precio de catálogo estimado: {formatCatalogPrice(row.service.price, currency)}
        </Text>
      )}
      <Input
        label={`Cantidad de ${label}`}
        value={row.quantityText}
        keyboardType="number-pad"
        inputMode="numeric"
        disabled={locked}
        onChangeText={onQuantity}
        error={!row.quantityValid ? 'Ingresa una cantidad entera entre 1 y 2147483647.' : undefined}
      />
      <Input
        label={`Precio unitario opcional de ${label}`}
        value={row.overrideText}
        keyboardType="decimal-pad"
        inputMode="decimal"
        disabled={locked}
        onChangeText={onOverride}
        helperText="Override explícito: decimal no negativo con dos posiciones."
        error={
          !row.overrideValid
            ? 'Ingresa un precio válido con dos decimales o usa el catálogo.'
            : undefined
        }
      />
      {row.estimate !== null ? (
        <Text style={styles.hint}>
          Estimación de {label}: {formatMoney(row.estimate, currency)}
        </Text>
      ) : (
        row.status === 'ready' && (
          <Text role="alert" style={styles.hint}>
            Importe de línea no válido.
          </Text>
        )
      )}
      <View style={styles.controls}>
        <Button
          label="Usar precio de catálogo"
          accessibilityLabel={`Usar precio de catálogo de ${label}`}
          variant="secondary"
          disabled={locked}
          onPress={onClearOverride}
        />
        <Button
          label="Quitar"
          accessibilityLabel={`Quitar servicio de ${label}`}
          variant="ghost"
          disabled={locked}
          onPress={onRemove}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  section: { gap: theme.spacing[16] },
  controls: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.spacing[8] },
  heading: { ...theme.typography.heading, color: theme.colors.textPrimary },
  text: { ...theme.typography.body, color: theme.colors.textPrimary },
  hint: { ...theme.typography.caption, color: theme.colors.textSecondary },
});
