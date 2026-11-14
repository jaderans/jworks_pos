import { describe, expect, it } from 'vitest';
import { findOrders } from '../src/domain/findOrder';
import type { Customer, Order, PrintOrder } from '../src/db/types';

const order = (over: Partial<Order>): Order => ({ id: Math.random().toString(36), number: 'QA-01', customerId: null, customerName: '', contact: '', lines: [], status: 'new', createdAt: 1, deleted: 0, ...over }) as Order;
const print = (over: Partial<PrintOrder>): PrintOrder => ({ id: Math.random().toString(36), number: 'PA-001', customerId: null, customerName: '', contact: '', lines: [], status: 'quote', createdAt: 1, deleted: 0, ...over }) as PrintOrder;
const leanna = { id: 'c1', name: 'Leanna Marnelle Rosales', phone: '0917 123 4567', email: 'leanna@jw.test', handle: '@leanna' } as Customer;

describe('finding an order at the counter', () => {
  const orders = [
    order({ id: 'o1', number: 'QA-01', designNo: 'CS01', customerId: 'c1', createdAt: 1 }),
    order({ id: 'o2', number: 'QA-02', customerName: 'Kaye Santos', contact: '0918 555 0101', createdAt: 2 }),
    order({ id: 'o3', number: 'QA-03', customerName: 'Gone', deleted: 1 }),
  ];
  const prints = [print({ id: 'p1', number: 'PA-001', designNo: 'CS05', customerName: 'Cenon Salazar', createdAt: 3 })];
  const ids = (q: string) => findOrders(q, orders, prints, [leanna]).map((f) => f.order.id);

  it('by design no. or order number, however it’s typed', () => {
    expect(ids('CS01')).toEqual(['o1']);
    expect(ids('cs 05')).toEqual(['p1']);
    expect(ids('qa02')).toEqual(['o2']);
    expect(ids('PA-001')).toEqual(['p1']);
  });

  it('by the customer’s name, phone or email, newest first; never a deleted order', () => {
    expect(ids('leanna')).toEqual(['o1']);
    expect(ids('4567')).toEqual(['o1']);
    expect(ids('0918-555')).toEqual(['o2']);
    expect(ids('salazar')).toEqual(['p1']);
    expect(ids('Gone')).toEqual([]);
    expect(ids('c')).toEqual([]);
  });

  it('an exact number comes before a partial one', () => {
    const many = [order({ id: 'a', number: 'QA-10', createdAt: 9 }), order({ id: 'b', number: 'QA-01', createdAt: 1 })];
    expect(findOrders('QA-01', many, [], []).map((f) => f.order.id)).toEqual(['b']);
    expect(findOrders('QA', many, [], []).map((f) => f.order.id)).toEqual(['a', 'b']);
  });
});
