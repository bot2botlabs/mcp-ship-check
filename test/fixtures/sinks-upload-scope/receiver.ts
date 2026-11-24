import multer from 'multer';
import { writeFileSync } from 'fs';
import { join } from 'path';
const store = multer({ dest: 'incoming' });
app.post('/upload', store.single('file'), (req, res) => {
  writeFileSync(join('incoming', req.body.filename), req.body.data);
  res.end();
});
