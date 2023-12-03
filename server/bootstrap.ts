import { startServer } from "./middleware.ts";

const smartParseInt = (variable: string | null | undefined): number | undefined => {
	if (typeof variable !== 'number') return undefined;
	const numval = parseInt(variable);
	if (isNaN(numval)) return undefined;
	return numval;
};

await startServer({
	serve: {
		port: smartParseInt(Deno.env.get('PORT')) || 8080,
		hostname: Deno.env.get('HOSTNAME'),
		cert: Deno.env.get('TLS_CERT'),
		key: Deno.env.get('TLS_KEY')
	},
	octo: {
		routesDir: 'src/routes'
	}
});

console.log('%cStartup done', 'color: green');
