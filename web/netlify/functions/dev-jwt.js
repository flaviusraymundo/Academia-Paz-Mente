const DAY_IN_SECONDS = 24 * 60 * 60;

const base64UrlEncode = (obj) =>
  Buffer.from(JSON.stringify(obj))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

exports.handler = async (event) => {
  try {
    const email =
      (event && event.queryStringParameters && event.queryStringParameters.email) ||
      "dev@example.com";
    const now = Math.floor(Date.now() / 1000);

    const header = { alg: "none", typ: "JWT" };
    const payload = {
      sub: email,
      email,
      role: "dev",
      iat: now,
      exp: now + DAY_IN_SECONDS,
      iss: "dev-jwt-netlify",
      aud: "web",
    };

    const token = `${base64UrlEncode(header)}.${base64UrlEncode(payload)}.dev`;

    return {
      statusCode: 200,
      headers: { "Content-Type": "text/plain" },
      body: token,
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: "error generating dev jwt",
    };
  }
};
