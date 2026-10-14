import { act, waitFor } from '@testing-library/react-native';
import { defaultScheduler, notifyManager } from '@tanstack/react-query';
import { useLayoutEffect } from 'react';
import { Text } from 'react-native';

import {
  useBusiness,
  type BusinessContextValue,
} from '@/features/business/context/BusinessContext';
import { productCategoriesKeys } from '@/features/products/constants/productCategoriesKeys';
import { useCreateProductCategory } from '@/features/products/hooks/useCreateProductCategory';
import {
  useProductCategoryDetail,
  type UseProductCategoryDetailResult,
} from '@/features/products/hooks/useProductCategoryDetail';
import {
  useProductCategoryList,
  type UseProductCategoryListResult,
} from '@/features/products/hooks/useProductCategoryList';
import { useUpdateProductCategory } from '@/features/products/hooks/useUpdateProductCategory';
import type {
  ProductCategoryMutationResult,
  UpdateProductCategoryVariables,
} from '@/features/products/hooks/productCategoryHook.types';
import type { ProductCategoryRow } from '@/features/products/repositories/productCategoriesRepository';
import type { CreateProductCategoryInput } from '@/features/products/schemas/productCategory.schema';
import { productCategoriesService } from '@/features/products/services/productCategoriesService';
import type {
  ProductCategoryError,
  ProductCategoryListParams,
  ProductCategoryListResult,
  ProductCategoryResult,
} from '@/features/products/types/productCategory.types';
import { queryClient as applicationQueryClient } from '@/lib/query/client';
import { createTestQueryClient } from '@/test/createTestQueryClient';
import { renderWithProviders } from '@/test/renderWithProviders';

jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
jest.mock('@/features/products/services/productCategoriesService', () => ({
  productCategoriesService: {
    getById: jest.fn(),
    listByBusiness: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
}));
const productCategory = jest.mocked(productCategoriesService);
const businessMock = jest.mocked(useBusiness);
const business = (id = 'b'): BusinessContextValue => ({
  status: 'success',
  error: null,
  isFetching: false,
  data: {
    membershipId: 'm',
    role: 'OWNER',
    business: { id, name: 'B', currency_code: 'ARS', timezone: 'UTC', is_active: true },
  },
});
const row: ProductCategoryRow = {
  id: 's',
  business_id: 'b',
  name: ' Corte ',
  is_active: false,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};
const input: CreateProductCategoryInput = {
  name: row.name,
};
const result = (value = row): ProductCategoryResult => ({ data: value, error: null });
const page = (items = [row]): ProductCategoryListResult => ({
  data: { items, page: 1, pageSize: 25, hasNextPage: false },
  error: null,
});
const error: ProductCategoryError = {
  code: 'PRODUCT_CATEGORY_ACCESS_DENIED',
  message: 'No se pudo acceder a la categoría.',
};
const defaults = { page: 1, pageSize: 25, status: 'active' } as const;
let detail: UseProductCategoryDetailResult;
let list: UseProductCategoryListResult;
let create: ProductCategoryMutationResult<CreateProductCategoryInput>;
let update: ProductCategoryMutationResult<UpdateProductCategoryVariables>;
function Detail({ id = 's' }: { id?: string | null }) {
  const current = useProductCategoryDetail(id);
  useLayoutEffect(() => {
    detail = current;
  });
  return <Text>{current.status}</Text>;
}
function List({ params }: { params?: ProductCategoryListParams }) {
  const current = useProductCategoryList(params);
  useLayoutEffect(() => {
    list = current;
  });
  return <Text>{current.status}</Text>;
}
function Create() {
  const current = useCreateProductCategory();
  useLayoutEffect(() => {
    create = current;
  });
  return <Text>{current.status}</Text>;
}
function Update() {
  const current = useUpdateProductCategory();
  useLayoutEffect(() => {
    update = current;
  });
  return <Text>{current.status}</Text>;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
// Microtasks let async act flush scheduled query notifications before it resolves.
// Keep production scheduling unchanged and restore it after this suite.
beforeAll(() => {
  notifyManager.setScheduler(queueMicrotask);
});
afterAll(() => {
  notifyManager.setScheduler(defaultScheduler);
});
beforeEach(() => {
  businessMock.mockReturnValue(business());
  productCategory.getById.mockResolvedValue(result());
  productCategory.listByBusiness.mockResolvedValue(page());
  productCategory.create.mockResolvedValue(result());
  productCategory.update.mockResolvedValue(result());
});

test('detail pending/success passes original IDs, preserves inactive row and inherits global60s with retryfalse', async () => {
  const pending = deferred<ProductCategoryResult>();
  productCategory.getById.mockReturnValue(pending.promise);
  businessMock.mockReturnValue(business(' Original B '));
  const queryClient = createTestQueryClient();
  queryClient.setDefaultOptions(applicationQueryClient.getDefaultOptions());
  await renderWithProviders(<Detail id=" Original S " />, { queryClient });
  expect(detail.status).toBe('pending');
  expect(detail.isFetching).toBe(true);
  expect(productCategory.getById).toHaveBeenCalledWith(' Original B ', ' Original S ');
  const query = queryClient
    .getQueryCache()
    .find({ queryKey: productCategoriesKeys.detail(' Original B ', ' Original S '), exact: true });
  expect(query?.options.retry).toBe(false);
  expect(queryClient.defaultQueryOptions({ queryKey: query!.queryKey }).staleTime).toBe(60000);
  await act(async () => {
    pending.resolve(result());
  });
  await waitFor(() => expect(detail.status).toBe('success'));
  expect(detail.data).toEqual(row);
  expect(detail.data?.is_active).toBe(false);
  expect(detail.isFetching).toBe(false);
  expect(Object.keys(detail).sort()).toEqual(['data', 'error', 'isFetching', 'status']);
  expect(productCategory.getById).toHaveBeenCalledTimes(1);
});
test('active detail remains successful', async () => {
  productCategory.getById.mockResolvedValue(result({ ...row, is_active: true }));
  await renderWithProviders(<Detail />);
  await waitFor(() => expect(detail.status).toBe('success'));
  expect(detail.data?.is_active).toBe(true);
});
test.each([null, '', '   '])(
  'unusable detail ID %s is idle, no productCategory call',
  async (id) => {
    await renderWithProviders(<Detail id={id} />);
    expect(detail).toEqual({ status: 'idle', data: null, error: null, isFetching: false });
    expect(productCategory.getById).not.toHaveBeenCalled();
  },
);
test.each(['idle', 'pending', 'error', 'blank'])(
  'business %s gates both queries without productCategory calls',
  async (state) => {
    businessMock.mockReturnValue(
      state === 'blank'
        ? business(' ')
        : ({ status: state, data: null, error: null, isFetching: false } as BusinessContextValue),
    );
    await renderWithProviders(
      <>
        <Detail />
        <List />
      </>,
    );
    expect(detail.status).toBe('idle');
    expect(list.status).toBe('idle');
    expect(productCategory.getById).not.toHaveBeenCalled();
    expect(productCategory.listByBusiness).not.toHaveBeenCalled();
  },
);
test.each([
  'PRODUCT_CATEGORY_NOT_FOUND',
  'PRODUCT_CATEGORY_ACCESS_DENIED',
  'NETWORK_ERROR',
  'UNKNOWN_ERROR',
] as const)('detail error %s is preserved without retry', async (code) => {
  const safe = { ...error, code };
  productCategory.getById.mockResolvedValue({ data: null, error: safe });
  await renderWithProviders(<Detail />);
  await waitFor(() => expect(detail.status).toBe('error'));
  expect(detail.data).toBeNull();
  expect(detail.error).toBe(safe);
  expect(productCategory.getById).toHaveBeenCalledTimes(1);
});
test.each(['business', 'productCategory'])(
  'detail %s switch hides old success and late replies',
  async (scope) => {
    const rendered = await renderWithProviders(<Detail />);
    await waitFor(() => expect(detail.status).toBe('success'));
    const next = deferred<ProductCategoryResult>();
    productCategory.getById.mockReturnValue(next.promise);
    if (scope === 'business') businessMock.mockReturnValue(business('b2'));
    await rendered.rerender(<Detail id={scope === 'productCategory' ? 's2' : 's'} />);
    expect(detail.status).toBe('pending');
    expect(detail.data).toBeNull();
    await act(async () => {
      next.resolve(result({ ...row, id: 's2', business_id: scope === 'business' ? 'b2' : 'b' }));
    });
    await waitFor(() => expect(detail.status).toBe('success'));
    expect(detail.data?.id).toBe('s2');
  },
);
test('detail failed background refresh hides stale data and reports fetching while in flight', async () => {
  const rendered = await renderWithProviders(<Detail />);
  await waitFor(() => expect(detail.status).toBe('success'));
  const refresh = deferred<ProductCategoryResult>();
  productCategory.getById.mockReturnValue(refresh.promise);
  let operation!: Promise<void>;
  await act(async () => {
    operation = rendered.queryClient.invalidateQueries({
      queryKey: productCategoriesKeys.byBusiness('b'),
    });
  });
  await waitFor(() => expect(detail.isFetching).toBe(true));
  await act(async () => {
    refresh.resolve({ data: null, error });
    await operation;
  });
  await waitFor(() => expect(detail.status).toBe('error'));
  expect(detail.data).toBeNull();
  expect(detail.error).toBe(error);
});

test('list defaults normalize before key/productCategory; explicit defaults reuse cache and empty result is success', async () => {
  productCategory.listByBusiness.mockResolvedValue(page([]));
  const queryClient = createTestQueryClient();
  queryClient.setDefaultOptions(applicationQueryClient.getDefaultOptions());
  const rendered = await renderWithProviders(<List />, { queryClient });
  await waitFor(() => expect(list.status).toBe('success'));
  expect(productCategory.listByBusiness).toHaveBeenLastCalledWith('b', defaults);
  expect(list.data?.items).toEqual([]);
  expect(
    queryClient
      .getQueryCache()
      .find({ queryKey: productCategoriesKeys.list('b', defaults), exact: true })?.options.retry,
  ).toBe(false);
  expect(
    queryClient.defaultQueryOptions({ queryKey: productCategoriesKeys.list('b', defaults) })
      .staleTime,
  ).toBe(60000);
  await rendered.rerender(<List params={{ ...defaults }} />);
  expect(productCategory.listByBusiness).toHaveBeenCalledTimes(1);
  expect(list.status).toBe('success');
});
test.each(['active', 'inactive', 'all'] as const)(
  'list %s preserves page/rows/sentinel metadata without filtering client-side',
  async (status) => {
    productCategory.listByBusiness.mockResolvedValue({
      data: { items: [row], page: 2, pageSize: 7, hasNextPage: true },
      error: null,
    });
    await renderWithProviders(<List params={{ status, page: 2, pageSize: 7 }} />);
    await waitFor(() => expect(list.status).toBe('success'));
    expect(productCategory.listByBusiness).toHaveBeenCalledWith('b', {
      status,
      page: 2,
      pageSize: 7,
    });
    expect(list.data).toEqual({ items: [row], page: 2, pageSize: 7, hasNextPage: true });
  },
);
test('invalid list params expose safe error without entering an invalid key or calling productCategory', async () => {
  const rendered = await renderWithProviders(<List params={{ page: 0 }} />);
  expect(list.status).toBe('error');
  expect(list.error?.code).toBe('UNKNOWN_ERROR');
  expect(productCategory.listByBusiness).not.toHaveBeenCalled();
  expect(
    rendered.queryClient
      .getQueryCache()
      .getAll()
      .every((query) => !JSON.stringify(query.queryKey).includes('"page":0')),
  ).toBe(true);
});
test.each(['business', 'page', 'status', 'pageSize'])(
  'list %s transition does not display old page',
  async (scope) => {
    const rendered = await renderWithProviders(<List />);
    await waitFor(() => expect(list.status).toBe('success'));
    const next = deferred<ProductCategoryListResult>();
    productCategory.listByBusiness.mockReturnValue(next.promise);
    if (scope === 'business') businessMock.mockReturnValue(business('b2'));
    const params: ProductCategoryListParams =
      scope === 'page'
        ? { page: 2 }
        : scope === 'status'
          ? { status: 'inactive' }
          : scope === 'pageSize'
            ? { pageSize: 7 }
            : {};
    await rendered.rerender(<List params={params} />);
    expect(list.status).toBe('pending');
    expect(list.data).toBeNull();
    await act(async () => {
      next.resolve(page([]));
    });
    await waitFor(() => expect(list.status).toBe('success'));
  },
);
test('list error preserves productCategory error with retryfalse and no old page', async () => {
  productCategory.listByBusiness.mockResolvedValue({ data: null, error });
  await renderWithProviders(<List />);
  await waitFor(() => expect(list.status).toBe('error'));
  expect(list.error).toBe(error);
  expect(list.data).toBeNull();
  expect(productCategory.listByBusiness).toHaveBeenCalledTimes(1);
});

for (const kind of ['create', 'update'] as const) {
  test(`${kind} mutation captures original business, forwards exact values, waits scoped invalidation and resets`, async () => {
    const pending = deferred<ProductCategoryResult>();
    productCategory[kind].mockReturnValue(pending.promise);
    const rendered = await renderWithProviders(kind === 'create' ? <Create /> : <Update />);
    const invalidatePending = deferred<void>();
    const invalidate = jest
      .spyOn(rendered.queryClient, 'invalidateQueries')
      .mockReturnValue(invalidatePending.promise);
    const setData = jest.spyOn(rendered.queryClient, 'setQueryData');
    let operation!: Promise<ProductCategoryRow>;
    await act(async () => {
      operation =
        kind === 'create'
          ? create.mutateAsync(input)
          : update.mutateAsync({
              productCategoryId: ' Original S ',
              input: { name: ' Editada ', is_active: false },
            });
    });
    const read = () => (kind === 'create' ? create : update);
    await waitFor(() => expect(read().status).toBe('pending'));
    expect(productCategory[kind]).toHaveBeenCalledTimes(1);
    if (kind === 'create') expect(productCategory.create).toHaveBeenCalledWith('b', input);
    else
      expect(productCategory.update).toHaveBeenCalledWith('b', ' Original S ', {
        name: ' Editada ',
        is_active: false,
      });
    expect(rendered.queryClient.getMutationCache().getAll()[0].options.retry).toBe(false);
    expect(setData).not.toHaveBeenCalled();
    await act(async () => {
      pending.resolve(result());
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: productCategoriesKeys.byBusiness('b') });
    expect(read().status).toBe('pending');
    await act(async () => {
      invalidatePending.resolve();
      expect(await operation).toEqual(row);
    });
    await waitFor(() => expect(read().status).toBe('success'));
    expect(read().data).toEqual(row);
    expect(setData).not.toHaveBeenCalled();
    expect(Object.keys(read()).sort()).toEqual(['data', 'error', 'mutateAsync', 'reset', 'status']);
    await act(async () => {
      read().reset();
    });
    await waitFor(() => expect(read().status).toBe('idle'));
    expect(read().data).toBeNull();
  });
  test(`${kind} late result invalidates A only and stays hidden under business B`, async () => {
    const pending = deferred<ProductCategoryResult>();
    productCategory[kind].mockReturnValue(pending.promise);
    const rendered = await renderWithProviders(kind === 'create' ? <Create /> : <Update />);
    const invalidate = jest.spyOn(rendered.queryClient, 'invalidateQueries');
    let operation!: Promise<ProductCategoryRow>;
    await act(async () => {
      operation =
        kind === 'create'
          ? create.mutateAsync(input)
          : update.mutateAsync({ productCategoryId: 's', input: { is_active: true } });
    });
    await waitFor(() => expect((kind === 'create' ? create : update).status).toBe('pending'));
    if (kind === 'update') {
      expect(productCategory.update).toHaveBeenCalledWith('b', 's', { is_active: true });
    }
    businessMock.mockReturnValue(business('b2'));
    await rendered.rerender(kind === 'create' ? <Create /> : <Update />);
    expect((kind === 'create' ? create : update).status).toBe('idle');
    await act(async () => {
      pending.resolve(result());
      await operation;
    });
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: productCategoriesKeys.byBusiness('b') });
    expect((kind === 'create' ? create : update).status).toBe('idle');
    expect((kind === 'create' ? create : update).data).toBeNull();
  });
  test(`${kind} missing business rejects safely with no productCategory call and reset clears local error`, async () => {
    businessMock.mockReturnValue({ status: 'idle', data: null, error: null, isFetching: false });
    await renderWithProviders(kind === 'create' ? <Create /> : <Update />);
    await act(async () => {
      await expect(
        kind === 'create'
          ? create.mutateAsync(input)
          : update.mutateAsync({ productCategoryId: 's', input: { is_active: false } }),
      ).rejects.toEqual(error);
    });
    await waitFor(() => expect((kind === 'create' ? create : update).status).toBe('error'));
    expect(productCategory[kind]).not.toHaveBeenCalled();
    await act(async () => {
      (kind === 'create' ? create : update).reset();
    });
    await waitFor(() => expect((kind === 'create' ? create : update).status).toBe('idle'));
  });
  test(`${kind} normalized error persists until reset, with no invalidation or retries`, async () => {
    productCategory[kind].mockResolvedValue({ data: null, error });
    const rendered = await renderWithProviders(kind === 'create' ? <Create /> : <Update />);
    const invalidate = jest.spyOn(rendered.queryClient, 'invalidateQueries');
    await act(async () => {
      await expect(
        kind === 'create'
          ? create.mutateAsync(input)
          : update.mutateAsync({ productCategoryId: 's', input: { is_active: false } }),
      ).rejects.toBe(error);
    });
    await waitFor(() => expect((kind === 'create' ? create : update).status).toBe('error'));
    expect((kind === 'create' ? create : update).error).toBe(error);
    await rendered.rerender(kind === 'create' ? <Create /> : <Update />);
    expect((kind === 'create' ? create : update).error).toBe(error);
    expect(productCategory[kind]).toHaveBeenCalledTimes(1);
    expect(invalidate).not.toHaveBeenCalled();
    await act(async () => {
      (kind === 'create' ? create : update).reset();
    });
    await waitFor(() => expect((kind === 'create' ? create : update).status).toBe('idle'));
  });
}
test.each([null, '', '   '])(
  'update unusable ID %s rejects locally without productCategory call',
  async (productCategoryId) => {
    await renderWithProviders(<Update />);
    const variables = {
      productCategoryId,
      input: { is_active: false },
    } as unknown as UpdateProductCategoryVariables;
    await act(async () => {
      await expect(update.mutateAsync(variables)).rejects.toEqual({
        code: 'PRODUCT_CATEGORY_NOT_FOUND',
        message: 'No se encontró la categoría o no está disponible.',
      });
    });
    expect(productCategory.update).not.toHaveBeenCalled();
    await waitFor(() => expect(update.status).toBe('error'));
  },
);
test('late query A completion cannot replace currently selected business B', async () => {
  const a = deferred<ProductCategoryResult>(),
    b = deferred<ProductCategoryResult>();
  productCategory.getById.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
  const rendered = await renderWithProviders(<Detail />);
  businessMock.mockReturnValue(business('b2'));
  await rendered.rerender(<Detail />);
  await act(async () => {
    a.resolve(result());
  });
  expect(detail.data).toBeNull();
  await act(async () => {
    b.resolve(result({ ...row, business_id: 'b2' }));
  });
  await waitFor(() => expect(detail.status).toBe('success'));
  expect(detail.data?.business_id).toBe('b2');
});

test('late list A completion cannot replace currently selected business B', async () => {
  const a = deferred<ProductCategoryListResult>(),
    b = deferred<ProductCategoryListResult>();
  productCategory.listByBusiness.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
  const rendered = await renderWithProviders(<List />);
  businessMock.mockReturnValue(business('b2'));
  await rendered.rerender(<List />);
  await act(async () => {
    a.resolve(page());
  });
  expect(list.data).toBeNull();
  await act(async () => {
    b.resolve(page([]));
  });
  await waitFor(() => expect(list.status).toBe('success'));
  expect(list.data?.items).toEqual([]);
});

test('failed list background refresh hides its previously successful page', async () => {
  const rendered = await renderWithProviders(<List />);
  await waitFor(() => expect(list.status).toBe('success'));
  productCategory.listByBusiness.mockResolvedValue({ data: null, error });
  await act(async () => {
    await rendered.queryClient.invalidateQueries({
      queryKey: productCategoriesKeys.byBusiness('b'),
    });
  });
  await waitFor(() => expect(list.status).toBe('error'));
  expect(list.data).toBeNull();
  expect(list.error).toBe(error);
});
