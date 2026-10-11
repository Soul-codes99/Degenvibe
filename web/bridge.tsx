// Mounts Privy invisibly and exposes a small, stable object (window.dvPrivy) to the game page.
import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { PrivyProvider, usePrivy, useWallets } from '@privy-io/react-auth';

const APP_ID: string = (import.meta as any).env?.VITE_PRIVY_APP_ID || 'cmv1ne8fh00ie0fkz8qyjwgfr';   // public, safe to ship
const RPC = 'https://rpc.testnet.chain.robinhood.com', EXPLORER = 'https://explorer.testnet.chain.robinhood.com';
const robinhoodTestnet = {
  id: 46630, name: 'Robinhood Chain Testnet', network: 'robinhood-testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC] }, public: { http: [RPC] } },
  blockExplorers: { default: { name: 'Explorer', url: EXPLORER } },
};

function Bridge() {
  const { ready, authenticated, login, logout, getAccessToken } = usePrivy();
  const { wallets } = useWallets();
  useEffect(() => {
    const P = ((window as any).dvPrivy ??= {});          // one stable object, so the page can read live values
    Object.assign(P, {
      ready, authenticated, login, logout, getAccessToken, wallets,
      provider: async () => {
        const w: any = wallets.find((x: any) => x.walletClientType === 'privy') ?? wallets[0];
        if (!w) throw new Error('wallet is not ready yet');
        await w.switchChain(robinhoodTestnet.id);
        return w.getEthereumProvider();                   // a standard EIP-1193 provider, same as MetaMask's
      },
    });
    window.dispatchEvent(new Event('dv-privy'));
  }, [ready, authenticated, wallets, login, logout, getAccessToken]);
  return null;
}

createRoot(document.getElementById('privy-root')!).render(
  <PrivyProvider
    appId={APP_ID}
    config={{
      loginMethods: ['email', 'google', 'twitter', 'discord'],
      appearance: { theme: 'dark', accentColor: '#d9f20a' },
      embeddedWallets: { ethereum: { createOnLogin: 'users-without-wallets' }, showWalletUIs: false },   // no popups: a run starts in one tap
      defaultChain: robinhoodTestnet as any,
      supportedChains: [robinhoodTestnet as any],
    }}
  >
    <Bridge />
  </PrivyProvider>,
);
