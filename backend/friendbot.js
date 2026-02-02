const DEFAULT_FRIENDBOT_URL = "https://friendbot.stellar.org";

async function fundWithFriendbot(publicKey, options = {}) {
  if (typeof publicKey !== "string" || publicKey.length === 0) {
    throw new Error("publicKey required for friendbot");
  }
  const friendbotUrl = options.friendbotUrl || DEFAULT_FRIENDBOT_URL;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch is not available");
  }

  const url = new URL(friendbotUrl);
  url.searchParams.set("addr", publicKey);

  const response = await fetchImpl(url.toString(), { method: "GET" });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `friendbot request failed (${response.status}): ${text || "unknown error"}`
    );
  }
  try {
    return await response.json();
  } catch (_err) {
    return {};
  }
}

module.exports = {
  DEFAULT_FRIENDBOT_URL,
  fundWithFriendbot,
};
