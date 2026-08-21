import type {
  BaseRecord,
  CreateResponse,
  DataProvider,
  DeleteOneResponse,
  GetListResponse,
  GetOneResponse,
  UpdateResponse,
} from '@refinedev/core';
import { API_URL, apiFetch, type ListResponse } from '../lib/api.js';

/**
 * Refine data provider over the Ozo Thunder API.
 *
 * Custom rather than `@refinedev/simple-rest` for two reasons: our list
 * endpoints return `{ items, total }` rather than a bare array plus an
 * `x-total-count` header, and several resources are read-only.
 *
 * Refine's methods are generic in `TData extends BaseRecord`, but a REST
 * provider only learns the shape at runtime — so each response is asserted to
 * `TData` at the boundary. That assertion is the contract every Refine data
 * provider makes; the real type safety comes from the pages, which fetch
 * through `apiFetch<T>` with the shared types from `@ozothunder/shared`.
 */

function resourcePath(resource: string): string {
  return `/admin/${resource}`;
}

export const dataProvider: DataProvider = {
  getApiUrl: () => API_URL,

  async getList<TData extends BaseRecord = BaseRecord>({
    resource,
    filters,
  }: Parameters<DataProvider['getList']>[0]): Promise<GetListResponse<TData>> {
    const params = new URLSearchParams();

    // Only simple equality filters are used by these tables.
    for (const filter of filters ?? []) {
      if ('field' in filter && filter.operator === 'eq' && filter.value != null) {
        params.set(filter.field, String(filter.value));
      }
    }

    const query = params.toString();
    const response = await apiFetch<ListResponse<TData>>(
      `${resourcePath(resource)}${query === '' ? '' : `?${query}`}`,
    );

    return { data: response.items, total: response.total };
  },

  async getOne<TData extends BaseRecord = BaseRecord>({
    resource,
    id,
  }: Parameters<DataProvider['getOne']>[0]): Promise<GetOneResponse<TData>> {
    const data = await apiFetch<TData>(`${resourcePath(resource)}/${String(id)}`);
    return { data };
  },

  async create<TData extends BaseRecord = BaseRecord>({
    resource,
    variables,
  }: Parameters<DataProvider['create']>[0]): Promise<CreateResponse<TData>> {
    const data = await apiFetch<TData>(resourcePath(resource), {
      method: 'POST',
      body: JSON.stringify(variables),
    });
    return { data };
  },

  async update<TData extends BaseRecord = BaseRecord>({
    resource,
    id,
    variables,
  }: Parameters<DataProvider['update']>[0]): Promise<UpdateResponse<TData>> {
    const data = await apiFetch<TData>(`${resourcePath(resource)}/${String(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(variables),
    });
    return { data };
  },

  async deleteOne<TData extends BaseRecord = BaseRecord>({
    resource,
    id,
  }: Parameters<DataProvider['deleteOne']>[0]): Promise<DeleteOneResponse<TData>> {
    const data = await apiFetch<TData>(`${resourcePath(resource)}/${String(id)}`, {
      method: 'DELETE',
    });
    return { data };
  },
};
