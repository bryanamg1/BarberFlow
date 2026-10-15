import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Badge, Button, Card, EmptyState, ErrorState, LoadingState } from '@/components/ui';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { servicesKeys } from '@/features/services/constants/servicesKeys';
import { useServiceDetail } from '@/features/services/hooks/useServiceDetail';
import { useServiceList } from '@/features/services/hooks/useServiceList';
import { createServiceSchema } from '@/features/services/schemas/service.schema';
import { theme } from '@/theme';
import { formatCatalogPrice, formatMoney } from '@/utils/formatMoney';

import {
  createAppointmentItemSchema,
  type CreateAppointmentItemInput,
} from '../schemas/appointment.schema';

export type AppointmentServiceSelectorProps = {
  items: CreateAppointmentItemInput[];
  onChange: (items: CreateAppointmentItemInput[]) => void;
};

export function AppointmentServiceSelector({ items, onChange }: AppointmentServiceSelectorProps) {
  const business = useBusiness();
  const businessId = business.status === 'success' ? business.data.business.id : null;
  const previousBusiness = useRef(businessId);
  useEffect(() => {
    const previous = previousBusiness.current;
    previousBusiness.current = businessId;
    if (previous !== null && previous !== businessId && items.length > 0) onChange([]);
  }, [businessId, items, onChange]);

  if (business.status === 'pending') return <LoadingState message="Cargando negocio…" />;
  if (business.status === 'error') return <ErrorState message={business.error.message} />;
  if (business.status !== 'success') return <EmptyState title="Negocio no disponible" />;
  return (
    <Selector
      key={business.data.business.id}
      {...{ items, onChange }}
      businessId={business.data.business.id}
      currency={business.data.business.currency_code}
    />
  );
}

function Selector({
  items,
  onChange,
  businessId,
  currency,
}: AppointmentServiceSelectorProps & { businessId: string; currency: string }) {
  const [page, setPage] = useState(1);
  const params = { page, pageSize: 25, status: 'active' } as const;
  const result = useServiceList(params);
  const queryClient = useQueryClient();
  // Keep order and existing duplicate lines. Emit only the approved appointment DTO.
  const emit = (next: CreateAppointmentItemInput[]) =>
    onChange(next.map(({ serviceId, quantity }) => ({ serviceId, quantity })));
  const choices =
    result.status === 'success'
      ? [
          ...new Map(
            result.data.items
              .filter((service) => service.is_active && service.business_id === businessId)
              .map((service) => [service.id, service]),
          ).values(),
        ]
      : [];
  return (
    <View style={styles.section}>
      <Text role="heading" style={styles.heading}>
        Servicios
      </Text>
      <Text style={styles.hint}>
        Precios orientativos. El precio y la duración se confirman al guardar el turno.
      </Text>
      {items.length === 0 ? (
        <Text style={styles.text}>Sin servicios seleccionados</Text>
      ) : (
        items.map((item, index) => (
          <SelectedService
            key={`${index}:${item.serviceId}`}
            {...{ item, index, businessId, currency }}
            onRemove={() => emit(items.filter((_, position) => position !== index))}
            onQuantity={(quantity) =>
              emit(
                items.map((value, position) =>
                  position === index ? { serviceId: value.serviceId, quantity } : value,
                ),
              )
            }
          />
        ))
      )}
      {result.status === 'pending' ? (
        <LoadingState message="Cargando servicios…" />
      ) : result.status === 'idle' ? (
        <EmptyState title="Servicios no disponibles" />
      ) : result.status === 'error' ? (
        <ErrorState
          message={result.error.message}
          retrying={result.isFetching}
          onRetry={() => {
            void queryClient.invalidateQueries({
              queryKey: servicesKeys.list(businessId, params),
              exact: true,
            });
          }}
        />
      ) : (
        <View style={styles.section}>
          {choices.length === 0 ? (
            <EmptyState title="No hay servicios activos para seleccionar." />
          ) : (
            choices.map((service) => (
              <Card key={service.id} style={styles.section}>
                <Text style={styles.text}>{service.name}</Text>
                <Text style={styles.hint}>
                  {formatCatalogPrice(service.price, currency)} · {service.duration_minutes} minutos
                  por unidad
                </Text>
                <Button
                  label="Agregar"
                  accessibilityLabel={`Agregar servicio: ${service.name}`}
                  disabled={
                    result.isFetching || items.some((item) => item.serviceId === service.id)
                  }
                  onPress={() => emit([...items, { serviceId: service.id, quantity: 1 }])}
                />
              </Card>
            ))
          )}
          <View style={styles.controls}>
            <Button
              label="Anterior"
              variant="secondary"
              disabled={page <= 1 || result.isFetching}
              onPress={() => {
                if (page > 1) setPage(page - 1);
              }}
            />
            <Text role="status" aria-live="polite" style={styles.text}>
              Página {page}
            </Text>
            <Button
              label="Siguiente"
              variant="secondary"
              disabled={!result.data.hasNextPage || result.isFetching}
              onPress={() => {
                if (result.data.hasNextPage) setPage(page + 1);
              }}
            />
          </View>
        </View>
      )}
    </View>
  );
}

function SelectedService({
  item,
  index,
  businessId,
  currency,
  onRemove,
  onQuantity,
}: {
  item: CreateAppointmentItemInput;
  index: number;
  businessId: string;
  currency: string;
  onRemove: () => void;
  onQuantity: (quantity: number) => void;
}) {
  const result = useServiceDetail(item.serviceId);
  const queryClient = useQueryClient();
  const service =
    result.status === 'success' && result.data.business_id === businessId ? result.data : null;
  const validQuantity = createAppointmentItemSchema.shape.quantity.safeParse(item.quantity).success;
  const editable = service !== null && service.is_active && !result.isFetching && validQuantity;
  const estimate =
    service && service.is_active ? lineEstimate(service.price, item.quantity, currency) : null;
  const lineLabel = `línea ${index + 1}`;
  return (
    <Card style={styles.section}>
      <Text style={styles.text}>
        Servicio seleccionado ({lineLabel}): {service?.name ?? 'No disponible'}
      </Text>
      <Text style={styles.text}>Cantidad: {item.quantity}</Text>
      {result.status === 'pending' ? (
        <LoadingState message="Cargando servicio seleccionado…" />
      ) : result.status === 'error' ? (
        <ErrorState
          message={result.error.message}
          retrying={result.isFetching}
          onRetry={() => {
            void queryClient.invalidateQueries({
              queryKey: servicesKeys.detail(businessId, item.serviceId),
              exact: true,
            });
          }}
        />
      ) : service ? (
        <>
          {!service.is_active && (
            <>
              <Badge label="Archivado" />
              <Text style={styles.hint}>
                Se conserva la selección. Este servicio ya no está disponible para nuevas citas.
              </Text>
            </>
          )}
          <Text style={styles.hint}>
            Catálogo actual: {formatCatalogPrice(service.price, currency)} ·{' '}
            {service.duration_minutes} minutos por unidad
          </Text>
          {estimate !== null && (
            <Text style={styles.hint}>Estimación de catálogo de esta línea: {estimate}</Text>
          )}
        </>
      ) : (
        <EmptyState title="Servicio seleccionado no disponible" />
      )}
      {!validQuantity && (
        <Text role="alert" style={styles.hint}>
          Cantidad no válida.
        </Text>
      )}
      <View style={styles.controls}>
        <Button
          label="Reducir"
          accessibilityLabel={`Reducir cantidad de ${lineLabel}`}
          variant="secondary"
          disabled={
            !editable ||
            !createAppointmentItemSchema.shape.quantity.safeParse(item.quantity - 1).success
          }
          onPress={() => onQuantity(item.quantity - 1)}
        />
        <Button
          label="Aumentar"
          accessibilityLabel={`Aumentar cantidad de ${lineLabel}`}
          variant="secondary"
          disabled={
            !editable ||
            !createAppointmentItemSchema.shape.quantity.safeParse(item.quantity + 1).success
          }
          onPress={() => onQuantity(item.quantity + 1)}
        />
        <Button
          label="Quitar"
          accessibilityLabel={`Quitar servicio de ${lineLabel}`}
          variant="ghost"
          onPress={onRemove}
        />
      </View>
    </Card>
  );
}

// Informational only, exact decimal cents even when quantity exceeds safe float totals.
// This estimate is never emitted as input or used to create snapshots/appointment end.
function lineEstimate(price: number, quantity: number, currency: string): string | null {
  if (
    !createServiceSchema.shape.price.safeParse(price).success ||
    !createAppointmentItemSchema.shape.quantity.safeParse(quantity).success
  )
    return null;
  const [integer, fraction = ''] = price.toString().split('.');
  const cents = (BigInt(integer) * 100n + BigInt(fraction.padEnd(2, '0'))) * BigInt(quantity);
  return formatMoney(`${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`, currency);
}

const styles = StyleSheet.create({
  section: { gap: theme.spacing[16] },
  controls: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.spacing[8] },
  heading: { ...theme.typography.heading, color: theme.colors.textPrimary },
  text: { ...theme.typography.body, color: theme.colors.textPrimary },
  hint: { ...theme.typography.caption, color: theme.colors.textSecondary },
});
