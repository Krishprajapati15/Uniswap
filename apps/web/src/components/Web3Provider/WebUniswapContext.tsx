import { useAccountDrawer } from 'components/AccountDrawer/MiniPortfolio/hooks'
import { ModalState, miniPortfolioModalStateAtom } from 'components/AccountDrawer/constants'
import { useAccount } from 'hooks/useAccount'
import { useEthersProvider } from 'hooks/useEthersProvider'
import { useEthersSigner } from 'hooks/useEthersSigner'
import { useModalState } from 'hooks/useModalState'
import { useShowSwapNetworkNotification } from 'hooks/useShowSwapNetworkNotification'
import { useUpdateAtom } from 'jotai/utils'
import { useOneClickSwapSetting } from 'pages/Swap/settings/OneClickSwap'
import React, { PropsWithChildren, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { serializeSwapAddressesToURLParameters } from 'state/swap/hooks'
import { useGetGeneratePermitAsTransaction } from 'state/walletCapabilities/hooks/useGetGeneratePermitAsTransaction'
import { useIsAtomicBatchingSupportedByChainIdCallback } from 'state/walletCapabilities/hooks/useIsAtomicBatchingSupportedByChain'
import { useHasMismatchCallback, useOnHasAnyMismatch } from 'state/walletCapabilities/hooks/useMismatchAccount'
import { UniswapProvider } from 'uniswap/src/contexts/UniswapContext'
import { AccountMeta, AccountType } from 'uniswap/src/features/accounts/types'
import { getChainInfo } from 'uniswap/src/features/chains/chainInfo'
import { useEnabledChainsWithConnector } from 'uniswap/src/features/chains/hooks/useEnabledChains'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { FeatureFlags } from 'uniswap/src/features/gating/flags'
import { useFeatureFlag } from 'uniswap/src/features/gating/hooks'
import { MismatchContextProvider } from 'uniswap/src/features/smartWallet/mismatch/MismatchContext'
import { useHasAccountMismatchCallback } from 'uniswap/src/features/smartWallet/mismatch/hooks'
import { ModalName } from 'uniswap/src/features/telemetry/constants'
import { currencyIdToAddress, currencyIdToChain } from 'uniswap/src/utils/currencyId'
import { getTokenDetailsURL } from 'uniswap/src/utils/linking'
import { useEvent } from 'utilities/src/react/hooks'
import noop from 'utilities/src/react/noop'
import { Connector } from 'wagmi'

// Adapts useEthersProvider to fit uniswap context hook shape
function useWebProvider(chainId: number) {
  return useEthersProvider({ chainId })
}

function useWagmiAccount(): { account?: AccountMeta; connector?: Connector } {
  const account = useAccount()

  return useMemo(() => {
    if (!account.address) {
      return {
        account: undefined,
        connector: account.connector,
      }
    }

    return {
      account: {
        address: account.address,
        type: AccountType.SignerMnemonic,
      },
      connector: account.connector,
    }
  }, [account.address, account.connector])
}

export function WebUniswapProvider({ children }: PropsWithChildren): JSX.Element {
  return (
    <MismatchContextWrapper>
      <WebUniswapProviderInner>{children}</WebUniswapProviderInner>
    </MismatchContextWrapper>
  )
}

// Abstracts web-specific transaction flow objects for usage in cross-platform flows in the `uniswap` package.
function WebUniswapProviderInner({ children }: PropsWithChildren) {
  const { account, connector } = useWagmiAccount()
  const signer = useEthersSigner()
  const showSwapNetworkNotification = useShowSwapNetworkNotification()
  const accountDrawer = useAccountDrawer()
  const navigate = useNavigate()
  const navigateToFiatOnRamp = useCallback(() => navigate(`/buy`, { replace: true }), [navigate])

  const { closeModal: closeSearchModal } = useModalState(ModalName.Search)

  const navigateToSwapFlow = useCallback(
    ({ inputCurrencyId, outputCurrencyId }: { inputCurrencyId?: string; outputCurrencyId?: string }) => {
      const queryParams = serializeSwapAddressesToURLParameters({
        inputTokenAddress: inputCurrencyId ? currencyIdToAddress(inputCurrencyId) : undefined,
        outputTokenAddress: outputCurrencyId ? currencyIdToAddress(outputCurrencyId) : undefined,
        chainId: inputCurrencyId ? currencyIdToChain(inputCurrencyId) : undefined,
        outputChainId: outputCurrencyId ? currencyIdToChain(outputCurrencyId) : undefined,
      })
      navigate(`/swap${queryParams}`, { replace: true })
      closeSearchModal()
    },
    [navigate, closeSearchModal],
  )

  const navigateToSendFlow = useCallback(
    ({ chainId, currencyAddress }: { chainId: UniverseChainId; currencyAddress?: Address }) => {
      const chainUrlParam = getChainInfo(chainId).urlParam
      navigate(`/send?chain=${chainUrlParam}&inputCurrency=${currencyAddress}`, { replace: true })
      closeSearchModal()
    },
    [navigate, closeSearchModal],
  )

  const setReceiveModalState = useUpdateAtom(miniPortfolioModalStateAtom)
  const navigateToReceive = useCallback(() => setReceiveModalState(ModalState.QR_CODE), [setReceiveModalState])

  // no-op until we have a share token screen on web
  const handleShareToken = useCallback((_: { currencyId: string }) => {
    noop()
  }, [])

  const navigateToTokenDetails = useCallback(
    async (currencyId: string) => {
      const url = getTokenDetailsURL({
        address: currencyIdToAddress(currencyId),
        chain: currencyIdToChain(currencyId) ?? undefined,
      })
      navigate(url)
      closeSearchModal()
    },
    [navigate, closeSearchModal],
  )

  const getHasMismatch = useHasAccountMismatchCallback()
  const getIsUniswapXSupported = useEvent((innerChainId?: UniverseChainId) => {
    return !getHasMismatch(innerChainId)
  })
  const getGeneratePermitAsTransaction = useGetGeneratePermitAsTransaction()

  // no-op until we have an external profile screen on web
  const navigateToExternalProfile = useCallback((_: { address: Address }) => noop(), [])

  const navigateToNftCollection = useCallback((args: { collectionAddress: Address; chainId: UniverseChainId }) => {
    window.open(
      `https://opensea.io/assets/${getChainInfo(
        args.chainId,
      ).backendChain.chain.toLowerCase()}/${args.collectionAddress}`,
      '_blank',
      'noopener,noreferrer',
    )
  }, [])

  const { openModal } = useModalState(ModalName.DelegationMismatch)

  const handleOpenUniswapXUnsupportedModal = useEvent(() => {
    openModal()
  })

  const isBatchedSwapsFlagEnabled = useFeatureFlag(FeatureFlags.BatchedSwaps)
  const isAtomicBatchingSupportedByChain = useIsAtomicBatchingSupportedByChainIdCallback()

  const { enabled: isOneClickSwapSettingEnabled } = useOneClickSwapSetting()
  const getCanBatchTransactions = useEvent((chainId?: UniverseChainId | undefined) => {
    return Boolean(
      isBatchedSwapsFlagEnabled && isOneClickSwapSettingEnabled && chainId && isAtomicBatchingSupportedByChain(chainId),
    )
  })

  return (
    <UniswapProvider
      account={account}
      signer={signer}
      connector={connector}
      useProviderHook={useWebProvider}
      onSwapChainsChanged={showSwapNetworkNotification}
      navigateToFiatOnRamp={navigateToFiatOnRamp}
      navigateToSwapFlow={navigateToSwapFlow}
      navigateToSendFlow={navigateToSendFlow}
      navigateToReceive={navigateToReceive}
      navigateToTokenDetails={navigateToTokenDetails}
      navigateToExternalProfile={navigateToExternalProfile}
      navigateToNftCollection={navigateToNftCollection}
      handleShareToken={handleShareToken}
      onConnectWallet={accountDrawer.open}
      getGeneratePermitAsTransaction={getGeneratePermitAsTransaction}
      getIsUniswapXSupported={getIsUniswapXSupported}
      handleOnPressUniswapXUnsupported={handleOpenUniswapXUnsupportedModal}
      getCanBatchTransactions={getCanBatchTransactions}
    >
      {children}
    </UniswapProvider>
  )
}

const MismatchContextWrapper = React.memo(function MismatchContextWrapper({ children }: PropsWithChildren) {
  const getHasMismatch = useHasMismatchCallback()
  const account = useAccount()
  const onHasAnyMismatch = useOnHasAnyMismatch()
  const { chains, defaultChainId, isTestnetModeEnabled } = useEnabledChainsWithConnector(account.connector)
  return (
    <MismatchContextProvider
      mismatchCallback={getHasMismatch}
      address={account?.address}
      chainId={account?.chainId}
      onHasAnyMismatch={onHasAnyMismatch}
      chains={chains}
      defaultChainId={defaultChainId}
      isTestnetModeEnabled={isTestnetModeEnabled}
    >
      {children}
    </MismatchContextProvider>
  )
})

MismatchContextWrapper.displayName = 'MismatchContextWrapper'
