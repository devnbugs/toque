/**
 * Named Nusuk request catalog.
 *
 * Add simple requests here to expose them through:
 *   nusuk api list
 *   nusuk api <name>
 *
 * Fields:
 * - name: CLI-safe unique name
 * - description: short text shown in `nusuk api list`
 * - path: same-origin Nusuk API path (absolute external URLs are rejected)
 * - method: HTTP method
 * - payload: default request body, or omit for no body
 * - captcha: whether to inject captchaToken automatically
 */
export const REQUESTS = Object.freeze({
  "auto-login": Object.freeze({
    name: "auto-login",
    description: "Login to Nusuk and retrieve a fresh JWT auth token",
    path: "/eh/public/authentication/login",
    method: "POST",
    payload: Object.freeze({}),
    captcha: true,
    captchaField: "captchaResponse",
    extraHeaders: Object.freeze({
      "X-Lang": "en",
      "X-Channel": "ZlEW8G0jE195d1hY+hvN6/0T9KljTFeVg798I3V1t6I=",
    }),
  }),
  "company-info": Object.freeze({
    name: "company-info",
    description: "Show dashboard company information",
    path: "/umrah/reports_apis/api/Dashboard/DashboardCompanyInfo",
    method: "POST",
    payload: Object.freeze({}),
    captcha: false,
  }),
  "group-list": Object.freeze({
    name: "group-list",
    description: "List groups for the current entity",
    path: "/umrah/groups_apis/api/Groups/GetGroupList",
    method: "POST",
    payload: Object.freeze({
      limit: 10,
      offset: 0,
      filterList: Object.freeze([]),
      sortColumn: null,
      sortCriteria: Object.freeze([]),
      noCount: true,
    }),
    captcha: false,
  }),
  "groups-statistics": Object.freeze({
    name: "groups-statistics",
    description: "Get statistics for the current entity's groups",
    path: "/umrah/groups_apis/api/Groups/GroupsStatistics",
    method: "POST",
    payload: Object.freeze({}),
    captcha: false,
  }),
  "verify-subscription": Object.freeze({
    name: "verify-subscription",
    description: "Verify the current UO subscription status",
    path: "/umrah/contracts_apis/api/UoSubscription/VerifySubscriptionStatus",
    method: "POST",
    payload: Object.freeze({}),
    captcha: false,
  }),
});

export function listRequests() {
  return Object.values(REQUESTS);
}

export function getRequest(name) {
  return REQUESTS[String(name || "").trim().toLowerCase()] || null;
}
