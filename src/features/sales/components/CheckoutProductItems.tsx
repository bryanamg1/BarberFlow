import { uuid } from 'expo-modules-core';
import { useEffect, useRef, useState, type ReactNode, type ComponentType } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Badge, Button, Card, EmptyState, ErrorState, Input, LoadingState } from '@/components/ui';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { useProductList } from '@/features/products/hooks/useProductList';
import { theme } from '@/theme';
import { formatCatalogPrice, formatMoney } from '@/utils/formatMoney';

import { useCheckoutProductItems } from '../hooks/useCheckoutProductItems';
import type { CheckoutServiceEligibility } from './CheckoutServiceItems';
import {
  checkoutDraftStore,
  type CheckoutDraft,
  type CheckoutScope,
} from '../store/checkoutDraftStore';
import { addCheckoutProduct } from '../utils/checkoutProductItems';

export type CheckoutProductQuantityProps = {
  label: string;
  value: string;
  disabled: boolean;
  error?: string;
  onChangeText: (text: string) => void;
};

export function CheckoutProductItems({
  onEligibilityChange,
  selector,
  quantityField,
}: {
  onEligibilityChange?: (value: CheckoutServiceEligibility) => void;
  selector?: ReactNode;
  quantityField?: ComponentType<CheckoutProductQuantityProps>;
}) {
  const model = useCheckoutProductItems();
  const business = useBusiness();
  const callback = useRef(onEligibilityChange);
  const userId = model.scope?.userId;
  const businessId = model.scope?.businessId;
  const membershipId = model.scope?.membershipId;
  const operationId = model.draft?.operationId;
  useEffect(() => {
    callback.current = onEligibilityChange;
  }, [onEligibilityChange]);
  useEffect(() => {
    callback.current?.({
      scope: userId && businessId && membershipId ? { userId, businessId, membershipId } : null,
      operationId: operationId ?? null,
      eligible: model.eligible,
    });
  }, [userId, businessId, membershipId, operationId, model.eligible]);
  if (!model.scope || !model.draft || business.status !== 'success')
    return <EmptyState title="No hay una intención de checkout activa" />;
  const { scope, draft } = model;
  const currency = business.data.business.currency_code;
  return (
    <View style={styles.section}>
      <Text role="heading" style={styles.heading}>
        Productos del checkout
      </Text>
      <Text style={styles.hint}>Precio y stock orientativos; no se reserva inventario.</Text>
      {model.rows.length === 0 && <Text style={styles.text}>Sin productos seleccionados</Text>}
      {model.rows.map((row, index) => (
        <ProductLine
          key={`${draft.operationId}:${row.line.lineId}`}
          {...{ row, index, currency }}
          locked={model.locked}
          quantityField={quantityField}
          onQuantity={(text) => model.editLine(row.line.lineId, 'quantity', text)}
          onOverride={(text) => model.editLine(row.line.lineId, 'override', text)}
          onClear={() => model.clearOverride(row.line.lineId)}
          onRemove={() =>
            checkoutDraftStore.getState().removeLine(scope, draft.operationId, row.line.lineId)
          }
          onStockRetry={() => {
            void model.stock.refetch();
          }}
        />
      ))}
      {selector ?? (
        <CheckoutProductCatalog
          scope={scope}
          draft={draft}
          locked={model.locked}
          currency={currency}
        />
      )}
      <Text role="status" aria-live="polite" style={styles.hint}>
        {model.eligible
          ? 'Productos listos para revisión'
          : 'Revisa los productos y el stock antes de continuar'}
      </Text>
    </View>
  );
}

function CheckoutProductCatalog({
  scope,
  draft,
  locked,
  currency,
}: {
  scope: CheckoutScope;
  draft: CheckoutDraft;
  locked: boolean;
  currency: string;
}) {
  const identity = JSON.stringify([scope, draft.operationId]);
  const [pagination, setPagination] = useState({ identity, page: 1 });
  const page = pagination.identity === identity ? pagination.page : 1;
  const list = useProductList({ page, pageSize: 25, status: 'active' });
  return (
    <>
      {list.status === 'pending' ? (
        <LoadingState message="Cargando productos…" />
      ) : list.status === 'error' ? (
        <ErrorState
          message={list.error.message}
          retrying={list.isFetching}
          onRetry={() => {
            void list.refetch();
          }}
        />
      ) : list.status === 'success' ? (
        <>
          {list.data.items
            .filter((product) => product.is_active && product.business_id === scope.businessId)
            .map((product) => (
              <Card key={product.id} style={styles.section}>
                <Text style={styles.text}>{product.name}</Text>
                <Text style={styles.hint}>{formatCatalogPrice(product.sale_price, currency)}</Text>
                <Button
                  label="Agregar"
                  accessibilityLabel={`Agregar producto: ${product.name}`}
                  disabled={locked || list.isFetching}
                  onPress={() => {
                    addCheckoutProduct(scope, draft.operationId, uuid.v4(), product);
                  }}
                />
              </Card>
            ))}
          {list.data.items.filter(
            (product) => product.is_active && product.business_id === scope.businessId,
          ).length === 0 && <EmptyState title="No hay productos activos para seleccionar" />}
          <View style={styles.controls}>
            <Button
              label="Anterior"
              variant="secondary"
              disabled={page <= 1 || list.isFetching}
              onPress={() => setPagination({ identity, page: page - 1 })}
            />
            <Text role="status" style={styles.text}>
              Página {page}
            </Text>
            <Button
              label="Siguiente"
              variant="secondary"
              disabled={!list.data.hasNextPage || list.isFetching}
              onPress={() => setPagination({ identity, page: page + 1 })}
            />
          </View>
        </>
      ) : (
        <EmptyState title="Catálogo no disponible" />
      )}
    </>
  );
}

function ProductLine({
  row,
  index,
  currency,
  locked,
  onQuantity,
  onOverride,
  onClear,
  onRemove,
  onStockRetry,
  quantityField: QuantityField,
}: {
  row: ReturnType<typeof useCheckoutProductItems>['rows'][number];
  index: number;
  currency: string;
  locked: boolean;
  onQuantity: (text: string) => void;
  onOverride: (text: string) => void;
  onClear: () => void;
  onRemove: () => void;
  onStockRetry: () => void;
  quantityField?: ComponentType<CheckoutProductQuantityProps>;
}) {
  const label = `línea ${index + 1}`;
  const previousPrice = useRef(row.product?.sale_price);
  const [changed, setChanged] = useState(false);
  useEffect(() => {
    if (row.status !== 'ready' || !row.product) return;
    if (previousPrice.current !== undefined && previousPrice.current !== row.product.sale_price)
      setChanged(true);
    previousPrice.current = row.product.sale_price;
  }, [row.product, row.status]);
  const quantityProps = {
    label: `Cantidad de producto de ${label}`,
    value: row.quantityText,
    disabled: locked,
    onChangeText: onQuantity,
    error: !row.quantityValid ? 'Ingresa una cantidad entera entre 1 y 2147483647.' : undefined,
  };
  return (
    <Card style={styles.section}>
      <Text style={styles.text}>
        Producto ({label}): {row.product?.name ?? 'No disponible'}
      </Text>
      {row.status === 'loading' ? (
        <LoadingState message="Consultando producto seleccionado…" />
      ) : row.status === 'error' ? (
        <ErrorState
          message="No se pudo consultar el producto. Se conserva la selección."
          retryLabel={`Reintentar producto de ${label}`}
          onRetry={() => {
            void row.retry();
          }}
        />
      ) : row.status === 'unavailable' ? (
        <>
          <Badge label="No disponible" />
          <Text style={styles.hint}>
            La referencia se conserva. Quita o revisa esta línea para continuar.
          </Text>
        </>
      ) : null}
      {row.status === 'ready' && row.product && (
        <Text style={styles.hint}>
          Precio de catálogo estimado: {formatCatalogPrice(row.product.sale_price, currency)}
        </Text>
      )}
      {changed && (
        <Text role="status" style={styles.hint}>
          Precio de catálogo actualizado; tu override se conserva.
        </Text>
      )}
      {row.stock.status === 'loading' ? (
        <LoadingState message="Consultando stock…" />
      ) : row.stock.status === 'error' ? (
        <ErrorState
          message="No se pudo consultar el stock."
          retryLabel={`Reintentar stock de ${label}`}
          onRetry={onStockRetry}
        />
      ) : row.stock.status === 'unavailable' ? (
        <Text role="alert" style={styles.hint}>
          Stock no disponible; no se asume cero.
        </Text>
      ) : (
        <>
          <Text style={styles.hint}>
            Stock disponible: {row.stock.available} · Demanda total del producto: {row.stock.demand}
          </Text>
          {row.stock.status === 'insufficient' && (
            <Text role="alert" style={styles.hint}>
              Stock insuficiente para la demanda total.
            </Text>
          )}
        </>
      )}
      {QuantityField ? (
        <QuantityField {...quantityProps} />
      ) : (
        <Input {...quantityProps} inputMode="numeric" keyboardType="number-pad" />
      )}
      <Input
        label={`Precio unitario opcional de producto de ${label}`}
        value={row.overrideText}
        inputMode="decimal"
        keyboardType="decimal-pad"
        disabled={locked}
        onChangeText={onOverride}
        helperText="Override explícito: decimal no negativo con dos posiciones."
        error={
          !row.overrideValid
            ? 'Ingresa un importe válido con dos decimales o usa el catálogo.'
            : undefined
        }
      />
      {row.estimate !== null && (
        <Text style={styles.hint}>
          Estimación de producto de {label}: {formatMoney(row.estimate, currency)}
        </Text>
      )}
      <View style={styles.controls}>
        <Button
          label="Usar precio de catálogo"
          accessibilityLabel={`Usar precio de catálogo de producto de ${label}`}
          variant="secondary"
          disabled={locked}
          onPress={onClear}
        />
        <Button
          label="Quitar"
          accessibilityLabel={`Quitar producto de ${label}`}
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
