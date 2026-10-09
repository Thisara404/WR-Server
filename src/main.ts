import { createApplication } from "./bootstrap";
async function bootstrap() {
  const app = await createApplication();
  await app.listen(Number(process.env.PORT ?? 3001));
}
void bootstrap();
