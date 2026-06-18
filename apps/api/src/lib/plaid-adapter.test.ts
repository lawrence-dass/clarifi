import { describe, expect, it, vi } from "vitest";
import { AccountType, Provider } from "@clarifi/shared";
import { createPlaidAdapter, type PlaidClientLike } from "./plaid-adapter.js";

function fakeClient(): PlaidClientLike {
  return {
    linkTokenCreate: vi.fn(async () => ({ data: { link_token: "link-sandbox-123" } })),
    itemPublicTokenExchange: vi.fn(async () => ({
      data: { access_token: "access-sandbox-secret", item_id: "item-sandbox-1", request_id: "req-1" },
    })),
    accountsGet: vi.fn(async () => ({
      data: {
        item: {
          item_id: "item-sandbox-1",
          institution_id: "ins_1",
          institution_name: "Adapter Test Bank",
          webhook: null,
          error: null,
          available_products: [],
          billed_products: [],
          consent_expiration_time: null,
          update_type: "background",
        },
        request_id: "req-2",
        accounts: [
          {
            account_id: "plaid-checking-1",
            balances: { available: 120.34, current: 123.45, iso_currency_code: "CAD", unofficial_currency_code: null },
            mask: "0000",
            name: "Chequing",
            official_name: null,
            type: "depository",
            subtype: "checking",
          },
          {
            account_id: "plaid-card-1",
            balances: { available: null, current: 42.01, iso_currency_code: "USD", unofficial_currency_code: null },
            mask: "1111",
            name: "Credit",
            official_name: null,
            type: "credit",
            subtype: "credit card",
          },
          {
            account_id: "plaid-unknown-1",
            balances: { available: 9, current: null, iso_currency_code: "CAD", unofficial_currency_code: null },
            mask: null,
            name: "Unknown",
            official_name: null,
            type: "loan",
            subtype: "mystery",
          },
        ],
      },
    })),
  } as unknown as PlaidClientLike;
}

describe("plaid adapter", () => {
  it("creates link tokens scoped to the authenticated user", async () => {
    const client = fakeClient();
    const adapter = createPlaidAdapter(client);

    await expect(adapter.createLinkToken("user-1")).resolves.toBe("link-sandbox-123");
    expect(client.linkTokenCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        client_name: "Clarifi",
        language: "en",
        country_codes: ["CA", "US"],
        products: ["transactions"],
        user: { client_user_id: "user-1" },
      }),
    );
  });

  it("exchanges public tokens without transforming or logging secrets", async () => {
    const client = fakeClient();
    const adapter = createPlaidAdapter(client);

    await expect(adapter.exchangePublicToken("public-sandbox-token")).resolves.toEqual({
      accessToken: "access-sandbox-secret",
      itemId: "item-sandbox-1",
    });
    expect(client.itemPublicTokenExchange).toHaveBeenCalledWith({ public_token: "public-sandbox-token" });
  });

  it("maps Plaid accounts into canonical account records with integer cents", async () => {
    const adapter = createPlaidAdapter(fakeClient());

    const result = await adapter.getItemAccounts("access-sandbox-secret");

    expect(result.institutionName).toBe("Adapter Test Bank");
    expect(result.accounts).toEqual([
      {
        provider: Provider.plaid,
        providerAccountId: "plaid-checking-1",
        institutionName: "Adapter Test Bank",
        accountType: AccountType.checking,
        balanceCents: 12345n,
        currency: "CAD",
        mask: "0000",
      },
      {
        provider: Provider.plaid,
        providerAccountId: "plaid-card-1",
        institutionName: "Adapter Test Bank",
        accountType: AccountType.credit_card,
        balanceCents: 4201n,
        currency: "USD",
        mask: "1111",
      },
      {
        provider: Provider.plaid,
        providerAccountId: "plaid-unknown-1",
        institutionName: "Adapter Test Bank",
        accountType: AccountType.other,
        balanceCents: 900n,
        currency: "CAD",
      },
    ]);
  });
});
