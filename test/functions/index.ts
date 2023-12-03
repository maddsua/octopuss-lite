import { RouteConfig } from "../../server/routeHandlers.ts";

export const config: RouteConfig = {
	expand: true
};

export const handler = () => new Response("yo what's cooking [/index]\n this is a root path");
