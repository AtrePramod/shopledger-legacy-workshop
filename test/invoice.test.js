// Characterization tests for lib/invoice.js (Ticket 1: invoice vs. billed total).
// All data is in-memory. These tests never read or write data/db.json.
var test = require('node:test');
var assert = require('node:assert/strict');

var invoice = require('../lib/invoice');
var reports = require('../lib/reports');

// In-memory copies of the orders from the ticket (ledger figures = what the customer was billed).
function order1001() {
  return {
    id: 1001, date: '28/12/2021', customer: 'Meera Joshi', paymentMode: 'khata', status: 'completed',
    items: [
      { id: 8, sku: 'BEV-001', name: 'Assam CTC Masala Chai 250g', hsn: '0902', price: 140, qty: 2 },
      { id: 2, sku: 'GRN-002', name: 'Unpolished Toor Dal 1kg', hsn: '0713', price: 165, qty: 2 }
    ],
    coupon: '', subtotal: 610, discount: 0, tax: 66.9, total: 676.9
  };
}

function order1002() {
  return {
    id: 1002, date: '05/01/2022', customer: 'Anil Kulkarni', paymentMode: 'upi', status: 'completed',
    items: [
      { id: 1, sku: 'GRN-001', name: 'Indrayani Basmati Rice 5kg', hsn: '1006', price: 640, qty: 1 },
      { id: 4, sku: 'OIL-001', name: 'Cold-Pressed Sunflower Oil 1L', hsn: '1512', price: 190, qty: 2 }
    ],
    coupon: 'SAVE10', subtotal: 1020, discount: 102, tax: 45.9, total: 963.9
  };
}

function order1003() {
  return {
    id: 1003, date: '14/01/2022', customer: 'Walk-in', paymentMode: 'cash', status: 'completed',
    items: [
      { id: 7, sku: 'DRY-002', name: 'Pasteurized Table Butter 500g', hsn: '0405', price: 260, qty: 1 },
      { id: 8, sku: 'BEV-001', name: 'Assam CTC Masala Chai 250g', hsn: '0902', price: 140, qty: 1 }
    ],
    coupon: 'FLAT50', subtotal: 400, discount: 50, tax: 49.35, total: 399.35
  };
}

function order1004() {
  return {
    id: 1004, date: '30/01/2022', customer: 'Kalyani Foods (Wholesale)', paymentMode: 'khata', status: 'completed',
    items: [
      { id: 5, sku: 'OIL-002', name: 'Cold-Pressed Groundnut Oil 5L', hsn: '1508', price: 1120, qty: 2 }
    ],
    coupon: 'SAVE10', subtotal: 2240, discount: 150, tax: 104.5, total: 2194.5
  };
}

function order1007() {
  return {
    id: 1007, date: '04/03/2022', customer: 'Suresh Deshmukh', paymentMode: 'khata', status: 'pending',
    items: [
      { id: 6, sku: 'DRY-001', name: 'A2 Gir Cow Ghee 500ml', hsn: '0405', price: 450, qty: 2 },
      { id: 4, sku: 'OIL-001', name: 'Cold-Pressed Sunflower Oil 1L', hsn: '1512', price: 190, qty: 2 }
    ],
    coupon: '', subtotal: 1280, discount: 0, tax: 127, total: 1407
  };
}

function order1008() {
  return {
    id: 1008, date: '15/03/2022', customer: 'Walk-in', paymentMode: 'cash', status: 'completed',
    items: [
      { id: 8, sku: 'BEV-001', name: 'Assam CTC Masala Chai 250g', hsn: '0902', price: 140, qty: 1 },
      { id: 12, sku: 'BEV-003', name: 'Kokum Sherbet Concentrate 750ml', hsn: '2106', price: 180, qty: 2 }
    ],
    coupon: '', subtotal: 500, discount: 0, tax: 90, total: 590
  };
}

// ---------- Behaviour that is correct today ----------

test('all-18% order with no coupon (#1008) matches the billed total', function () {
  var inv = invoice.computeInvoiceFigures(order1008());
  assert.equal(inv.subtotal, 500);
  assert.equal(inv.discount, 0);
  assert.equal(inv.tax, 90);
  assert.equal(inv.cgst, 45);
  assert.equal(inv.sgst, 45);
  assert.equal(inv.total, 590);
});

test('order with no items gives zero totals', function () {
  var inv = invoice.computeInvoiceFigures({ id: 1, items: [], coupon: '' });
  assert.equal(inv.subtotal, 0);
  assert.equal(inv.tax, 0);
  assert.equal(inv.total, 0);
  assert.deepEqual(inv.rows, []);
});

test('render() produces an HTML tax invoice with the order number', function () {
  var html = invoice.render(order1008());
  assert.match(html, /INV-1008/);
  assert.match(html, /Tax Invoice/);
  assert.doesNotMatch(html, /Accountant Reconciliation Notice/);
});

test('render() escapes HTML in the customer name', function () {
  var o = order1008();
  o.customer = '<script>x</script>';
  var html = invoice.render(o);
  assert.doesNotMatch(html, /<script>x<\/script>/);
  assert.match(html, /&lt;script&gt;/);
});

// ---------- CURRENT BEHAVIOUR (looks wrong; pinned so we notice when it changes) ----------

test('CURRENT BEHAVIOUR: invoice ignores HSN slabs and taxes 5%/18% mix (#1001) at 18%', function () {
  var inv = invoice.computeInvoiceFigures(order1001());
  assert.deepEqual(inv.rows.map(function (r) { return r.gstPercent; }), [18, 18]);
  assert.equal(inv.tax, 109.8);    // ledger billed 66.90
  assert.equal(inv.total, 719.8);  // ledger billed 676.90
});

test('CURRENT BEHAVIOUR: #1002 SAVE10 invoice shows 1083.24 (183.60 GST) instead of billed 963.90', function () {
  var inv = invoice.computeInvoiceFigures(order1002());
  assert.equal(inv.tax, 183.6);
  assert.equal(inv.discount, 120.36); // 10% of (subtotal + tax), not of subtotal
  assert.equal(inv.total, 1083.24);
});

test('CURRENT BEHAVIOUR: #1004 SAVE10 ignores the 150 maxDiscount cap', function () {
  var inv = invoice.computeInvoiceFigures(order1004());
  assert.equal(inv.discount, 264.32); // cap is 150
  assert.equal(inv.tax, 403.2);
  assert.equal(inv.total, 2378.88);   // ledger billed 2194.50
});

test('CURRENT BEHAVIOUR: flat coupon (#1003) is subtracted after tax at 18%', function () {
  var inv = invoice.computeInvoiceFigures(order1003());
  assert.equal(inv.discount, 50);
  assert.equal(inv.tax, 72);    // ledger billed 49.35
  assert.equal(inv.total, 422); // ledger billed 399.35
});

test('CURRENT BEHAVIOUR: non-coupon 12%/5% order (#1007) taxed at 18%', function () {
  var inv = invoice.computeInvoiceFigures(order1007());
  assert.equal(inv.tax, 230.4);   // ledger billed 127.00
  assert.equal(inv.total, 1510.4); // ledger billed 1407.00
});

test('CURRENT BEHAVIOUR: coupon below minOrder is still applied on the invoice', function () {
  var o = order1008();
  o.items = [{ id: 8, sku: 'BEV-001', name: 'Chai', hsn: '0902', price: 100, qty: 1 }];
  o.coupon = 'SAVE10'; // minOrder 500
  var inv = invoice.computeInvoiceFigures(o);
  assert.equal(inv.discount, 11.8);
});

test('CURRENT BEHAVIOUR: render() shows a reconciliation warning for #1002', function () {
  var html = invoice.render(order1002());
  assert.match(html, /Accountant Reconciliation Notice/);
});

test('CURRENT BEHAVIOUR: GST reconciliation flags every sample order except #1008 (in-memory db)', function () {
  var db = { orders: [order1001(), order1002(), order1003(), order1004(), order1007(), order1008()] };
  var recon = reports.getGstReconciliation(db);
  assert.equal(recon.totalChecked, 6);
  assert.equal(recon.mismatchCount, 5);
  assert.deepEqual(
    recon.rows.filter(function (r) { return r.matched; }).map(function (r) { return r.orderId; }),
    [1008]
  );
});
