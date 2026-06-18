import { AccountType, Prisma, Provider, withUserContext, type CanonicalAccount } from "@clarifi/shared";
import { encryptSecret } from "../../lib/crypto.js";
import { AppError } from "../../lib/app-error.js";
import { plaidAdapter, type PlaidAdapter } from "../../lib/plaid-adapter.js";

export interface SafeAccountSummary {
  id: string;
  institutionName: string;
  accountType: AccountType;
  currency: string;
  mask?: string;
}

let activePlaidAdapter: PlaidAdapter = plaidAdapter;

export function setPlaidAdapterForTests(adapter: PlaidAdapter): () => void {
  const previous = activePlaidAdapter;
  activePlaidAdapter = adapter;
  return () => {
    activePlaidAdapter = previous;
  };
}

export async function createPlaidLinkToken(userId: string): Promise<string> {
  try {
    return await activePlaidAdapter.createLinkToken(userId);
  } catch {
    throw new AppError("PLAID_LINK_TOKEN_FAILED", 502, "Unable to create Plaid link token");
  }
}

export async function exchangePlaidPublicToken(input: {
  userId: string;
  publicToken: string;
}): Promise<SafeAccountSummary[]> {
  let exchange: Awaited<ReturnType<PlaidAdapter["exchangePublicToken"]>>;
  let itemAccounts: Awaited<ReturnType<PlaidAdapter["getItemAccounts"]>>;
  try {
    exchange = await activePlaidAdapter.exchangePublicToken(input.publicToken);
    itemAccounts = await activePlaidAdapter.getItemAccounts(exchange.accessToken);
  } catch {
    throw new AppError("PLAID_EXCHANGE_FAILED", 502, "Unable to connect Plaid item");
  }
  const encryptedAccessToken = encryptSecret(exchange.accessToken);

  return withUserContext(input.userId, async (tx) => {
    const plaidItem = await tx.plaidItem.upsert({
      where: { itemId: exchange.itemId },
      create: {
        userId: input.userId,
        itemId: exchange.itemId,
        accessTokenEncrypted: encryptedAccessToken,
        institutionName: itemAccounts.institutionName,
      },
      update: {
        accessTokenEncrypted: encryptedAccessToken,
        institutionName: itemAccounts.institutionName,
      },
      select: { id: true },
    });

    const summaries: SafeAccountSummary[] = [];
    for (const account of itemAccounts.accounts) {
      summaries.push(await upsertPlaidAccount(tx, input.userId, plaidItem.id, account));
    }
    return summaries;
  });
}

async function upsertPlaidAccount(
  tx: Prisma.TransactionClient,
  userId: string,
  plaidItemId: string,
  account: CanonicalAccount,
): Promise<SafeAccountSummary> {
  const row = await tx.account.upsert({
    where: {
      provider_providerAccountId: {
        provider: Provider.plaid,
        providerAccountId: account.providerAccountId,
      },
    },
    create: {
      userId,
      provider: Provider.plaid,
      providerAccountId: account.providerAccountId,
      institutionName: account.institutionName,
      accountType: account.accountType,
      balanceCents: account.balanceCents,
      currency: account.currency,
      plaidItemId,
    },
    update: {
      institutionName: account.institutionName,
      accountType: account.accountType,
      balanceCents: account.balanceCents,
      currency: account.currency,
      plaidItemId,
    },
    select: {
      id: true,
      institutionName: true,
      accountType: true,
      currency: true,
    },
  });

  return {
    ...row,
    ...(account.mask ? { mask: account.mask } : {}),
  };
}
