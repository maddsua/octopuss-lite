import { startServer } from "./middleware.ts";

await startServer({
	serve: {
		port: 8080
	},
	octo: {
		routesDir: 'src/routes'
	}
});

console.log('%cStartup done', 'color: green');
