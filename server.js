const fs = require('fs'), path = require('path'), express = require('express'), { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const TOKEN = process.env.API_TOKEN || '';
const COLS = ['productos', 'clientes', 'bodegas', 'ventas', 'pagos', 'ingresos', 'salidas', 'config', 'meta'];
const ID = /^[A-Za-z0-9_\-.~:@+]{1,200}$/;
const bad = (m) => Object.assign(new Error(m), { status: 400 });

const app = express();
app.use(express.json({ limit: '5mb' }));
app.get('/api/estado', (q, r) => {
  // Diagnóstico: muestra qué index.html está entregando este servidor
  const f = path.join(__dirname, 'public', 'index.html');
  let indexTitulo = null, indexModificado = null;
  try { indexTitulo = (fs.readFileSync(f, 'utf8').match(/<title>(.*?)<\/title>/) || [])[1] || null; indexModificado = fs.statSync(f).mtime; } catch (e) {}
  r.json({ app: 'tienda-abarrotes', requiereToken: !!TOKEN, indexTitulo, indexModificado });
});
app.use('/api', (q, r, n) => {
  if (TOKEN && q.get('authorization') !== 'Bearer ' + TOKEN) return r.status(401).json({ error: 'Código incorrecto' });
  n();
});
const col = (q, r, n) => (COLS.includes(q.params.col) ? n() : r.status(404).json({ error: 'colección' }));
const wrap = (f) => (q, r, n) => f(q, r).catch(n);

// Lote atómico: varias altas/bajas en una sola transacción (una venta = ticket + stock + cliente)
app.post('/api/lote', wrap(async (q, r) => {
  const c = await pool.connect();
  try {
    await c.query('begin');
    for (const o of q.body.ops || []) {
      const [t, id] = String(o.k).split('/');
      if (!COLS.includes(t) || !ID.test(id || '')) throw bad('clave inválida');
      if (o.tipo === 'set') {
        if (!o.data || typeof o.data !== 'object') throw bad('documento inválido');
        await c.query(`insert into ${t}(id,data) values($1,$2) on conflict(id) do update set data=excluded.data, actualizado=now()`, [id, o.data]);
      } else if (o.tipo === 'del') await c.query(`delete from ${t} where id=$1`, [id]);
      else throw bad('operación inválida');
    }
    await c.query('commit'); r.json({ ok: true });
  } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
}));

app.get('/api/:col', col, wrap(async (q, r) => {
  const lim = Math.min(parseInt(q.query.limite) || 1000, 1000);
  const { rows } = await pool.query(`select data from ${q.params.col} where id > $1 order by id limit $2`, [q.query.despues || '', lim]);
  r.json(rows.map((x) => x.data));
}));
app.get('/api/:col/:id', col, wrap(async (q, r) => {
  const { rows } = await pool.query(`select data from ${q.params.col} where id=$1`, [q.params.id]);
  rows.length ? r.json(rows[0].data) : r.sendStatus(404);
}));
app.put('/api/:col/:id', col, wrap(async (q, r) => {
  if (!ID.test(q.params.id) || !q.body || typeof q.body !== 'object') throw bad('datos inválidos');
  await pool.query(`insert into ${q.params.col}(id,data) values($1,$2) on conflict(id) do update set data=excluded.data, actualizado=now()`, [q.params.id, q.body]);
  r.json({ ok: true });
}));
app.delete('/api/:col/:id', col, wrap(async (q, r) => {
  await pool.query(`delete from ${q.params.col} where id=$1`, [q.params.id]); r.sendStatus(204);
}));

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, f) => { if (f.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache'); }
}));
app.use((e, q, r, n) => { console.error(e.message); r.status(e.status || 500).json({ error: e.message }); });

(async () => {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  for (let i = 0; ; i++) {
    try { await pool.query(schema); break; }
    catch (e) { if (i >= 30) throw e; console.log('Esperando a PostgreSQL...'); await new Promise((r) => setTimeout(r, 2000)); }
  }
  app.listen(process.env.PORT || 3000, () => console.log('Tienda lista en el puerto ' + (process.env.PORT || 3000)));
})();
