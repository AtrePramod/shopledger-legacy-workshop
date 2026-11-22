// Characterization tests for Order History (lib/orders.js, lib/dates.js) and
// Khata settlements (lib/ledger.js) for Ticket 3.
// All data is in-memory. These tests never read or write data/db.json.
var test = require('node:test');
var assert = require('node:assert/strict');

var orders = require('../lib/orders');
var dates = require('../lib/dates');
var ledger = require('../lib/ledger');

function o(id, date, extra) {
  var base = { id: id, date: date, customer: 'Walk-in', status: 'completed', coupon: '', items: [], total: 100 };
  return Object.assign(base, extra || {});
}

function ordersDb() {
  return {
    orders: [
      o(1001, '28/12/2021', { customer: 'Meera Joshi' }),
      o(1002, '05/01/2022', { customer: 'Anil Kulkarni', coupon: 'SAVE10' }),
      o(1003, '14/01/2022', { coupon: 'FLAT50' }),
      o(1004, '30/01/2022', { customer: 'Kalyani Foods (Wholesale)', coupon: 'SAVE10' }),
      o(1005, '02/02/2022', { customer: 'Priya Nair', coupon: 'FLAT50' }),
      o(1006, '18/02/2022', { customer: 'Meera Joshi', coupon: 'WELCOME' }),
      o(1007, '04/03/2022', { customer: 'Suresh Deshmukh', status: 'pending' }),
      o(1008, '15/03/2022')
    ]
  };
}

function ids(list) { return list.map(function (x) { return x.id; }); }

function customersDb() {
  return {
    nextSettlementId: 505,
    settlements: [],
    customers: [
      { id: 1, name: 'Meera Joshi', creditLimit: 5000, openingBalance: 450, totalBilled: 1982.01, totalSettled: 1200, balance: 1232.01 }
    ]
  };
}

// ---------- Behaviour that is correct today ----------

test('status filter returns only matching orders', function () {
  assert.deepEqual(ids(orders.list(ordersDb(), { status: 'pending' })), [1007]);
});

test('search matches customer name, coupon, and order id', function () {
  assert.deepEqual(ids(orders.list(ordersDb(), { search: 'meera' })).sort(), [1001, 1006]);
  assert.deepEqual(ids(orders.list(ordersDb(), { search: 'welcome' })), [1006]);
  assert.deepEqual(ids(orders.list(ordersDb(), { search: '1008' })), [1008]);
});

test('normalizeDateKey converts YYYY-MM-DD to DD/MM/YYYY and leaves DD/MM/YYYY alone', function () {
  assert.equal(dates.normalizeDateKey('2022-01-31'), '31/01/2022');
  assert.equal(dates.normalizeDateKey('31/01/2022'), '31/01/2022');
  assert.equal(dates.normalizeDateKey(''), '');
});

test('getFiscalYear uses April as the first month', function () {
  assert.equal(dates.getFiscalYear('15/03/2022'), 'FY21-22');
  assert.equal(dates.getFiscalYear('01/04/2022'), 'FY22-23');
});

test('settlement with a numeric amount updates totals correctly', function () {
  var db = customersDb();
  var r = ledger.recordSettlement(db, 1, 500, 'cash', '');
  assert.equal(r.ok, true);
  assert.equal(r.customer.totalSettled, 1700);
  assert.equal(r.customer.balance, 732.01);
  assert.equal(db.settlements[0].amount, 500);
});

test('settlement rejects zero, negative, and unknown customer', function () {
  assert.equal(ledger.recordSettlement(customersDb(), 1, 0).ok, false);
  assert.equal(ledger.recordSettlement(customersDb(), 1, -5).ok, false);
  assert.equal(ledger.recordSettlement(customersDb(), 99, 10).ok, false);
});

// ---------- CURRENT BEHAVIOUR (looks wrong; pinned so we notice when it changes) ----------

test('CURRENT BEHAVIOUR: "newest first" sorts DD/MM/YYYY as text, so #1004 and #1001 come before #1008', function () {
  assert.deepEqual(ids(orders.list(ordersDb(), {})), [1004, 1001, 1006, 1008, 1003, 1002, 1007, 1005]);
});

test('CURRENT BEHAVIOUR: January 2022 date filter returns every order', function () {
  var r = orders.list(ordersDb(), { from: '2022-01-01', to: '2022-01-31' });
  assert.equal(r.length, 8);
});

test('CURRENT BEHAVIOUR: December 2021 date filter returns every order', function () {
  var r = orders.list(ordersDb(), { from: '2021-12-01', to: '2021-12-31' });
  assert.equal(r.length, 8);
});

test('CURRENT BEHAVIOUR: ₹500 settlement sent as text makes Total Settled "1200500"', function () {
  var db = customersDb();
  var r = ledger.recordSettlement(db, '1', '500', 'cash', '');
  assert.equal(r.customer.totalSettled, '1200500');
  assert.equal(r.customer.balance, -1198067.99);
});

test('CURRENT BEHAVIOUR: non-numeric settlement amount "abc" is accepted', function () {
  var r = ledger.recordSettlement(customersDb(), 1, 'abc', 'cash', '');
  assert.equal(r.ok, true);
  assert.equal(r.customer.totalSettled, '1200abc');
});
