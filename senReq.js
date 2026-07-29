import { Nusuk } from "./src/nusuk.js";

function loadJsonEnv(name) {
  const value = process.env[name];
  if (!value) return null;
  return JSON.parse(value);
}

async function main() {
  const authPath = process.env.AUTH_PATH || "auth.json";
  const nusuk = new Nusuk().loadAuth(authPath).loadEntity();
  await nusuk.init();

  try {
    const pageInfo = await nusuk.pageInfo();
    const payload = loadJsonEnv("MASAR_POST_BODY");
    const headers = loadJsonEnv("MASAR_POST_HEADERS") || {};
    const path = "/umrah/groups_apis/api/Groups/SendToIssueVisa";
    const response = await nusuk.request(path, {
      method: "POST",
      payload,
      headers,
    });

    return {
      base_url: nusuk.baseUrl,
      path,
      session: pageInfo,
      response,
    };
  } finally {
    await nusuk.close();
  }
}

main()
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
  })
  .catch((error) => {
    console.error("ERROR", error?.name || "Error", error?.message || String(error));
    console.error(error);
    process.exitCode = 1;
  });
