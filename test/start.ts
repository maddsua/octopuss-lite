import { startServer } from "../server/middleware.ts";

await startServer({
	serve: {
		port: 8080,
	},
	octo: {
		routesDir: 'test/functions',
	}
});
