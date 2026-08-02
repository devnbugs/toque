import assert from "node:assert/strict";
import test from "node:test";
import { getRequest, listRequests } from "../src/requests.js";

test("request catalog exposes subscription verification as POST", () => {
  const request = getRequest("verify-subscription");
  assert.deepEqual(request, {
    name: "verify-subscription",
    description: "Verify the current UO subscription status",
    path: "/umrah/contracts_apis/api/UoSubscription/VerifySubscriptionStatus",
    method: "POST",
    payload: {},
    captcha: false,
  });
});

test("request catalog lookup is normalized and unknown requests return null", () => {
  assert.equal(getRequest(" VERIFY-SUBSCRIPTION ")?.method, "POST");
  assert.equal(getRequest("missing"), null);
  assert.ok(listRequests().some((request) => request.name === "verify-subscription"));
});

test("request catalog exposes groups statistics as an empty-body POST", () => {
  const request = getRequest("groups-statistics");
  assert.deepEqual(request, {
    name: "groups-statistics",
    description: "Get statistics for the current entity's groups",
    path: "/umrah/groups_apis/api/Groups/GroupsStatistics",
    method: "POST",
    payload: {},
    captcha: false,
  });
});

test("request catalog exposes the default paged group list", () => {
  const request = getRequest("group-list");
  assert.equal(request.path, "/umrah/groups_apis/api/Groups/GetGroupList");
  assert.equal(request.method, "POST");
  assert.deepEqual(request.payload, {
    limit: 10,
    offset: 0,
    filterList: [],
    sortColumn: null,
    sortCriteria: [],
    noCount: true,
  });
});

test("request catalog exposes dashboard company info as POST", () => {
  const request = getRequest("company-info");
  assert.deepEqual(request, {
    name: "company-info",
    description: "Show dashboard company information",
    path: "/umrah/reports_apis/api/Dashboard/DashboardCompanyInfo",
    method: "POST",
    payload: {},
    captcha: false,
  });
});
