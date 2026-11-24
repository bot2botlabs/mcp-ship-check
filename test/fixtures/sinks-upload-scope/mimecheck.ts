import { writeFileSync } from 'fs';
import { join } from 'path';
app.post('/upload', (req, res) => {
  const file = req.files.doc;
  if (file.mimetype !== 'image/png') return res.status(415).end();
  writeFileSync(join('public/uploads', req.body.filename), file.data);
  res.end();
});
