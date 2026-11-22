// Characterization tests for lib/inventory.js and order cancellation (Ticket 2).
// All data is in-memory. These tests never read or write data/db.json.
var test = require('node:test');
var assert = require('node:assert/strict');

var inventory = require('../lib/inventory');
var orders = require('../lib/orders');

function products() {
  return [
    { id: 1, sku: 'GRN-001', name: 'Indrayani Basmati Rice 5kg', price: 640, stock: 18, reserved: 2 },
    { id: 4, sku: 'OIL-001', name: 'Cold-Pressed Sunflower Oil 1L', price: 190, stock: 22, reserved: 4 },
    { id: 6, sku: 'DRY-001', name: 'A2 Gir Cow Ghee 500ml', price: 450, stock: 1, reserved: 0 },
    { id: 10, sku: 'GRN-004', name: 'Organic Kolhapuri Jaggery 1kg', price: 85, stock: 0, reserved: 0 },
    { id: 11, sku: 'SPC-001', name: 'Byadgi Kashmiri Chilli Powder 500g', price: 220, stock: 4, reserved: 3 }
  ];
}

function dbWithPendingOrder() {
  var p = products();
  p[2].stock = 3; // ghee after #1007 took 2
  return {
    products: p,
    customers: [{ id: 4, name: 'Suresh Deshmukh', openingBalance: 1200, totalBilled: 1407, totalSettled: 1000, creditLimit: 15000 }],
    orders: [{
      id: 1007, date: '04/03/2022', customer: 'Suresh Deshmukh', customerId: 4, paymentMode: 'khata', status: 'pending',
      items: [
        { id: 6, sku: 'DRY-001', name: 'A2 Gir Cow Ghee 500ml', hsn: '0405', price: 450, qty: 2 },
        { id: 4, sku: 'OIL-001', name: 'Cold-Pressed Sunflower Oil 1L', hsn: '1512', price: 190, qty: 2 }
      ],
      coupon: '', subtotal: 1280, discount: 0, tax: 127, total: 1407
    }]
  };
}

// ---------- Behaviour that is correct today ----------

test('getSellableStock = physical stock minus reserved', function () {
  var p = products();
  assert.equal(inventory.getSellableStock(p[0]), 16);
  assert.equal(inventory.getSellableStock(p[4]), 1);
  assert.equal(inventory.getSellableStock(null), 0);
  assert.equal(inventory.getSellableStock({ stock: 1, reserved: 5 }), 0);
});

test('check() allows a quantity below sellable stock', function () {
  assert.deepEqual(inventory.check(products(), [{ id: 1, qty: 5 }]), { ok: true });
});

test('check() rejects more than sellable stock', function () {
  var r = inventory.check(products(), [{ id: 1, qty: 17 }]);
  assert.equal(r.ok, false);
  assert.match(r.msg, /out of stock \(16 sellable available\)/);
});

test('check() rejects an out-of-stock product and an unknown product', function () {
  assert.equal(inventory.check(products(), [{ id: 10, qty: 1 }]).ok, false);
  assert.deepEqual(inventory.check(products(), [{ id: 99, qty: 1 }]), { ok: false, msg: 'Unknown product 99' });
});

test('reserve() deducts sold quantity from physical stock', function () {
  var p = products();
  inventory.reserve(p, [{ id: 1, qty: 3 }]);
  assert.equal(p[0].stock, 15);
  assert.equal(p[0].reserved, 2);
});

test('cancel() marks the order cancelled and reverses the khata debit', function () {
  var db = dbWithPendingOrder();
  var r = orders.cancel(db, 1007, 'test');
  assert.equal(r.ok, true);
  assert.equal(db.orders[0].status, 'cancelled');
  assert.equal(db.customers[0].totalBilled, 0);
  assert.equal(orders.cancel(db, 1007).ok, false);
});

// ---------- CURRENT BEHAVIOUR (looks wrong; pinned so we notice when it changes) ----------

test('CURRENT BEHAVIOUR: cannot sell the last sellable ghee jar (DRY-001, 1 sellable)', function () {
  var r = inventory.check(products(), [{ id: 6, qty: 1 }]);
  assert.equal(r.ok, false);
  assert.match(r.msg, /out of stock \(1 sellable available\)/);
});

test('CURRENT BEHAVIOUR: cannot sell the last sellable chilli packet (SPC-001, physical 4, reserved 3)', function () {
  assert.equal(inventory.check(products(), [{ id: 11, qty: 1 }]).ok, false);
});

test('CURRENT BEHAVIOUR: buying exactly the sellable stock of any SKU fails', function () {
  assert.equal(inventory.check(products(), [{ id: 1, qty: 16 }]).ok, false);
});

test('CURRENT BEHAVIOUR: cancelling pending #1007 does not return items to stock', function () {
  var db = dbWithPendingOrder();
  orders.cancel(db, 1007, 'test');
  assert.equal(db.products[2].stock, 3); // ghee stays 3 (should be 5)
  assert.equal(db.products[1].stock, 22); // oil stays 22 (should be 24)
});

test('CURRENT BEHAVIOUR: release() looks up items by productId, so order lines are ignored', function () {
  var p = products();
  inventory.release(p, [{ id: 4, qty: 2 }]);
  assert.equal(p[1].stock, 22);
  assert.equal(p[1].reserved, 4);
});
