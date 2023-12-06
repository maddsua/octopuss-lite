import { loadFunctionsFromFS, transformHandlers } from "./routeHandlers.ts";
import { defaultConfig } from "./config.ts";
import { OctoMiddleware, type StartServerOptions } from "./middleware.ts";

export const startServer = async (opts?: StartServerOptions) => {

	const searchDir = opts?.octo?.routesDir || defaultConfig.routesDir;
	const routesPool = opts?.handlers ? transformHandlers(opts.handlers) : await loadFunctionsFromFS(searchDir);
	const middleware = new OctoMiddleware(routesPool, opts?.octo);

	if (!opts?.serve) {
		Deno.serve(middleware.handler.bind(middleware));
		return
	}

	Deno.serve(opts?.serve, middleware.handler.bind(middleware));
};
