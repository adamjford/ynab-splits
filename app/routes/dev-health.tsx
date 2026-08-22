import { getEnv } from "~/services/env.server";
import { secureData, secureResponse } from "~/services/response.server";

export function loader() {
  const isDevelopmentInstance =
    process.env.NODE_ENV === "development" &&
    typeof process.env.INSTANCE_ID === "string" &&
    process.env.INSTANCE_ID.length > 0;

  if (!isDevelopmentInstance) {
    return secureResponse(new Response("Development health route is not enabled.", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    }));
  }

  const env = getEnv();
  return secureData({
    ok: true,
    instanceId: env.INSTANCE_ID,
    origin: env.APP_ORIGIN,
  });
}
