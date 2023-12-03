import { startServer } from "./middleware.ts";

startServer({
	serve: {
		port: 8080
	},
	octo: {
		routesDir: 'src/routes'
	}
});
