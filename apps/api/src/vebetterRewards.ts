import { Address, Transaction } from '@vechain/sdk-core';
import { ProviderInternalBaseWallet, ThorClient, VeChainProvider, type TransactionReceipt } from '@vechain/sdk-network';
import { getAddress, getBytes, Interface } from 'ethers';
import { createHash } from 'crypto';

import type { AppConfig } from './config.js';

const DISTRIBUTE_REWARD_ABI = [
  // Current VeBetter testnet rewards pool supports the deprecated entrypoint.
  'function distributeRewardDeprecated(bytes32 appId,uint256 amount,address receiver,string rewardMetadata)'
];

const distributeIface = new Interface(DISTRIBUTE_REWARD_ABI);

function isBytes32Hex(value: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(value.trim());
}

function isPrivateKeyHex(value: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(value.trim());
}

function defaultNodeUrl(network: 'testnet' | 'mainnet'): string {
  // Prefer explicit env var in production. Defaults are for local/dev convenience.
  return network === 'mainnet' ? 'https://mainnet.vechain.org' : 'https://testnet.vechain.org';
}

type RewardsChainConfig = {
  network: 'testnet' | 'mainnet';
  nodeUrl: string;
  appId: string;
  rewardsPoolAddress: string;
  feeDelegationUrl: string;
  distributorPrivateKey: string;
};

function requireRewardsChainConfig(config: AppConfig): RewardsChainConfig {
  const nodeUrl = config.VECHAIN_NODE_URL ?? defaultNodeUrl(config.VECHAIN_NETWORK);

  if (!config.VEBETTER_APP_ID || !isBytes32Hex(config.VEBETTER_APP_ID)) {
    throw new Error('rewards_unconfigured');
  }
  if (!config.X2EARN_REWARDS_POOL_ADDRESS) {
    throw new Error('rewards_unconfigured');
  }
  if (!config.FEE_DELEGATION_URL) {
    throw new Error('rewards_unconfigured');
  }
  if (!config.REWARD_DISTRIBUTOR_PRIVATE_KEY || !isPrivateKeyHex(config.REWARD_DISTRIBUTOR_PRIVATE_KEY)) {
    throw new Error('rewards_unconfigured');
  }

  return {
    network: config.VECHAIN_NETWORK,
    nodeUrl,
    appId: config.VEBETTER_APP_ID,
    rewardsPoolAddress: getAddress(config.X2EARN_REWARDS_POOL_ADDRESS),
    feeDelegationUrl: config.FEE_DELEGATION_URL,
    distributorPrivateKey: config.REWARD_DISTRIBUTOR_PRIVATE_KEY
  };
}

type SignerContext = {
  thorClient: ThorClient;
  provider: VeChainProvider;
  signerAddress: string;
  signer: Awaited<ReturnType<VeChainProvider['getSigner']>>;
  cfg: RewardsChainConfig;
};

export type SignRewardDistributionInput = {
  receiver: string;
  amountWei: bigint;
  claimId: string;
  description: string;
  rewardMetadata: string;
};

export type RewardsChain = {
  signRewardDistributionTx: (input: SignRewardDistributionInput) => Promise<{ txHash: string; rawTx: string }>;
  broadcastRawTransaction: (rawTx: string) => Promise<{ txHash: string }>;
  getTransactionReceipt: (txHash: string) => Promise<TransactionReceipt | null>;
};

export function createRewardsChain(config: AppConfig): RewardsChain {
  if (config.REWARDS_MODE === 'mock') {
    function mockRawTx(claimId: string): string {
      return `0x${claimId.replace(/-/g, '')}`;
    }

    function mockTxHashFromRawTx(rawTx: string): string {
      return `0x${createHash('sha256').update(rawTx).digest('hex')}`;
    }

    return {
      async signRewardDistributionTx(input: SignRewardDistributionInput): Promise<{ txHash: string; rawTx: string }> {
        // Keep basic validation behavior consistent with chain mode.
        getAddress(input.receiver);
        if (input.amountWei <= 0n) throw new Error('amount_invalid');

        const rawTx = mockRawTx(input.claimId);
        const txHash = mockTxHashFromRawTx(rawTx);
        return { txHash, rawTx };
      },

      async broadcastRawTransaction(rawTx: string): Promise<{ txHash: string }> {
        return { txHash: mockTxHashFromRawTx(rawTx) };
      },

      async getTransactionReceipt(txHash: string): Promise<TransactionReceipt | null> {
        const now = Math.floor(Date.now() / 1000);
        return {
          gasUsed: 0,
          gasPayer: '0x0000000000000000000000000000000000000000',
          paid: '0',
          reward: '0',
          reverted: false,
          outputs: [],
          meta: {
            blockID: '0x' + '0'.repeat(64),
            blockNumber: 1,
            blockTimestamp: now,
            txID: txHash,
            txOrigin: '0x0000000000000000000000000000000000000000'
          }
        };
      }
    };
  }

  let thorClient: ThorClient | null = null;
  let signerContext: SignerContext | null = null;

  function getThorClient(): ThorClient {
    if (thorClient) return thorClient;
    const nodeUrl = config.VECHAIN_NODE_URL ?? defaultNodeUrl(config.VECHAIN_NETWORK);
    thorClient = ThorClient.at(nodeUrl, { isPollingEnabled: false });
    return thorClient;
  }

  async function getSignerContext(): Promise<SignerContext> {
    if (signerContext) return signerContext;

    const cfg = requireRewardsChainConfig(config);

    const thorClient = getThorClient();

    const pkBytes = getBytes(cfg.distributorPrivateKey);
    if (pkBytes.length !== 32) {
      throw new Error('rewards_unconfigured');
    }

    const signerAddress = Address.ofPrivateKey(pkBytes).toString();
    const wallet = new ProviderInternalBaseWallet(
      [{ address: signerAddress, privateKey: pkBytes }],
      { gasPayer: { gasPayerServiceUrl: cfg.feeDelegationUrl } }
    );
    const provider = new VeChainProvider(thorClient, wallet, true);
    const signer = await provider.getSigner(signerAddress);
    if (!signer) {
      throw new Error('rewards_unconfigured');
    }

    signerContext = { thorClient, provider, signerAddress, signer, cfg };
    return signerContext;
  }

  return {
    async signRewardDistributionTx(input: SignRewardDistributionInput): Promise<{ txHash: string; rawTx: string }> {
      const ctx = await getSignerContext();

      const receiver = getAddress(input.receiver);
      if (input.amountWei <= 0n) throw new Error('amount_invalid');

      const rewardMetadata = JSON.stringify({
        claimId: input.claimId,
        description: input.description,
        payload: input.rewardMetadata
      });

      const data = distributeIface.encodeFunctionData('distributeRewardDeprecated', [
        ctx.cfg.appId,
        input.amountWei,
        receiver,
        rewardMetadata
      ]);

      const rawTx = await ctx.signer!.signTransaction({
        to: ctx.cfg.rewardsPoolAddress,
        data,
        value: 0,
        comment: `BigBottle claim ${input.claimId}`
      });

      // VeChain tx id is blake2b256(tx_body), which is independent of the signature.
      const txId = Transaction.decode(getBytes(rawTx), true).getTransactionHash().toString();

      return { txHash: txId, rawTx };
    },

    async broadcastRawTransaction(rawTx: string): Promise<{ txHash: string }> {
      const res = await getThorClient().transactions.sendRawTransaction(rawTx);
      return { txHash: res.id };
    },

    async getTransactionReceipt(txHash: string): Promise<TransactionReceipt | null> {
      return await getThorClient().transactions.getTransactionReceipt(txHash);
    }
  };
}
