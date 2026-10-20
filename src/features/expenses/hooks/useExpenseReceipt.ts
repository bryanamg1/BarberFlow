import { useQueryClient } from '@tanstack/react-query';
import { uuid } from 'expo-modules-core';
import { openURL } from 'expo-linking';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { storageService } from '@/lib/storage';
import { expensesKeys } from '../constants/expensesKeys';
import { expensesService } from '../services/expensesService';
import { receiptPicker, type SelectedReceipt } from '../services/receiptPicker';
import type { ExpenseRow } from '../types/expense.types';
import { useExpenseLifecycle } from './useExpenseLifecycle';

type UploadIntent = { file: SelectedReceipt; expenseId: string; objectUuid: string; path?: string };
const attachmentError = 'No se pudo adjuntar el comprobante. El gasto guardado se conserva.';

// Local attachment state, separate from BF232's captured financial submit intent.
export function useExpenseReceipt(resource: string, currentPath: string | null) {
  const lifetime = useExpenseLifecycle(`expense-receipt:${resource}`);
  const client = useQueryClient();
  const [file, setFile] = useState<SelectedReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [attached, setAttached] = useState<ExpenseRow | null>(null);
  const [refreshError, setRefreshError] = useState(false);
  const lock = useRef(false);
  const intent = useRef<UploadIntent | null>(null);
  const [preview, setPreview] = useState<{
    path: string | null;
    epoch: symbol | null;
    url: string | null;
    expiresAt: number;
    state: 'idle' | 'pending' | 'ready' | 'error' | 'expired';
  }>({ path: null, epoch: null, url: null, expiresAt: 0, state: 'idle' });
  const path = attached?.receipt_path ?? currentPath;
  const previewVersion = useRef(0);
  useLayoutEffect(() => {
    previewVersion.current++;
  }, [path, lifetime.epoch]);
  const visiblePreview =
    preview.path === path && preview.epoch === lifetime.epoch
      ? preview
      : { url: null, expiresAt: 0, state: 'idle' as const };
  useEffect(() => {
    if (preview.state !== 'ready') return;
    const timer = setTimeout(
      () =>
        setPreview((current) =>
          current === preview ? { ...current, url: null, state: 'expired' } : current,
        ),
      Math.max(0, preview.expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [preview]);

  async function pick() {
    if (lock.current || !lifetime.isCurrent()) return;
    lock.current = true;
    const current = lifetime.isCurrent;
    // Invoke directly from the gesture; no async wait before the Web picker.
    const selection = receiptPicker.pick();
    setBusy(true);
    try {
      const result = await selection;
      if (!current()) return;
      if (result.status === 'selected') {
        setFile(result.file);
        intent.current = null;
        setError(null);
      } else if (result.status === 'error') setError(result.message);
    } catch {
      if (current()) setError('No se pudo seleccionar el comprobante. Inténtalo nuevamente.');
    } finally {
      lock.current = false;
      if (current()) setBusy(false);
    }
  }
  async function attach(row: ExpenseRow): Promise<ExpenseRow | null> {
    const scope = lifetime.scope;
    if (
      lock.current ||
      !lifetime.isCurrent() ||
      !scope ||
      !file ||
      row.source_type !== 'MANUAL' ||
      row.business_id !== scope.businessId
    )
      return null;
    lock.current = true;
    setBusy(true);
    setError(null);
    setRefreshError(false);
    const current = lifetime.isCurrent;
    try {
      const operation =
        intent.current?.file === file && intent.current.expenseId === row.id
          ? intent.current
          : { file, expenseId: row.id, objectUuid: uuid.v4() };
      intent.current = operation;
      if (!operation.path) {
        const uploaded = await storageService.upload({
          target: { kind: 'expenseReceipt', businessId: scope.businessId, expenseId: row.id },
          objectUuid: operation.objectUuid,
          body: file.body,
          contentType: file.contentType,
        });
        if (!current()) return null;
        if (uploaded.error) {
          setError(uploaded.error.message);
          return null;
        }
        operation.path = uploaded.data.path;
      }
      if (!current()) return null;
      // Only the attachment pointer is written; never replay create or other financial fields.
      const result = await expensesService.updateManual(scope.businessId, row.id, {
        receipt_path: operation.path,
      });
      if (!current()) return null;
      if (
        result.error ||
        result.data.id !== row.id ||
        result.data.business_id !== scope.businessId ||
        result.data.source_type !== 'MANUAL' ||
        result.data.receipt_path !== operation.path
      ) {
        setError(attachmentError);
        return null;
      }
      setAttached(result.data);
      setFile(null);
      intent.current = null;
      try {
        await client.invalidateQueries(
          { queryKey: expensesKeys.byBusiness(scope.businessId) },
          { throwOnError: true },
        );
      } catch {
        if (current()) setRefreshError(true);
      }
      return current() ? result.data : null;
    } catch {
      if (current()) setError(attachmentError);
      return null;
    } finally {
      lock.current = false;
      if (current()) setBusy(false);
    }
  }
  async function sign() {
    if (!path || lock.current || !lifetime.isCurrent()) return;
    lock.current = true;
    const current = lifetime.isCurrent;
    const version = previewVersion.current;
    setPreview({ path, epoch: lifetime.epoch, url: null, expiresAt: 0, state: 'pending' });
    try {
      const result = await storageService.createSignedUrl(path);
      if (!current() || version !== previewVersion.current) return;
      const url = result.data?.signedUrl;
      if (result.error || !url || !/^https?:\/\//i.test(url))
        setPreview({ path, epoch: lifetime.epoch, url: null, expiresAt: 0, state: 'error' });
      else
        setPreview({
          path,
          epoch: lifetime.epoch,
          url,
          expiresAt: Date.now() + 300_000,
          state: 'ready',
        });
    } catch {
      if (current() && version === previewVersion.current)
        setPreview({ path, epoch: lifetime.epoch, url: null, expiresAt: 0, state: 'error' });
    } finally {
      lock.current = false;
    }
  }
  async function open() {
    if (!lifetime.isCurrent() || !visiblePreview.url) return;
    if (Date.now() >= visiblePreview.expiresAt) {
      setPreview({ path, epoch: lifetime.epoch, url: null, expiresAt: 0, state: 'expired' });
      return;
    }
    const current = lifetime.isCurrent;
    try {
      await openURL(visiblePreview.url);
    } catch {
      if (current())
        setPreview({ path, epoch: lifetime.epoch, url: null, expiresAt: 0, state: 'error' });
    }
  }
  return {
    file,
    error,
    busy,
    attached,
    refreshError,
    path,
    preview: visiblePreview.state,
    pick,
    attach,
    sign,
    open,
  };
}
