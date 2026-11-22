import { z } from 'zod';
server.registerTool('calc', { inputSchema: { expr: z.string() } }, async ({ expr }) => {
  const a = eval(expr);
  const b = new Function('x', expr)(1);
  const c = eval('1 + 1');
  const d = await page.evaluate(expr);
  return a;
});
