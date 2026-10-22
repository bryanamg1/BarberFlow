const { appointmentFixture } = require('./appointment-fixture.cjs');
function checkoutFixture() {
  const f = appointmentFixture();
  const sale = (op, appointment = f.appointment) =>
    `private.persist_checkout_sale('${f.business}','${op}',${appointment === null ? 'NULL' : `'${appointment}'`},NULL,0,0,0)`;
  const completion = (op) => `private.complete_checkout_appointment('${f.business}','${op}')`;
  const pipeline = (op) => `DO $$ BEGIN
    PERFORM ${sale(op)};
    PERFORM private.persist_checkout_items('${f.business}','${op}','[{"itemType":"SERVICE","itemId":"${f.service}","quantity":1}]');
    PERFORM private.persist_checkout_payment('${f.business}','${op}','CASH');
    PERFORM private.persist_checkout_stock('${f.business}','${op}');
    PERFORM ${completion(op)};
    END $$;`;
  return { ...f, sale, completion, pipeline };
}
module.exports = { checkoutFixture };
