/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { Network } from '../../constants';
import { Address } from '../../types';
import { DummyDexHelper } from '../../dex-helper/index';
import { testEventSubscriber } from '../../../tests/utils-events';
import { FluidDexLiquidityProxyState } from './types';
import { FluidDexConfig } from './config';
import { FluidDexLiquidityProxy } from './fluid-dex-liquidity-proxy';
import { FluidDexFactory } from './fluid-dex-factory';

jest.setTimeout(50 * 1000);

async function fetchLiquidityProxyState(
  liquidityProxy: FluidDexLiquidityProxy,
  blockNumber: number,
): Promise<FluidDexLiquidityProxyState> {
  return liquidityProxy.generateState(blockNumber);
}

// eventName -> blockNumbers
type EventMappings = Record<string, number[]>;

describe('FluidDex EventPool Mainnet', function () {
  const dexKey = 'FluidDex';
  const network = Network.MAINNET;
  const dexHelper = new DummyDexHelper(network);
  const logger = dexHelper.getLogger(dexKey);

  const commonAddresses = FluidDexConfig.FluidDex[network].commonAddresses;

  describe('LiquidityProxy Events', () => {
    let liquidityProxy: FluidDexLiquidityProxy;

    // poolAddress -> EventMappings
    const eventsToTest: Record<Address, EventMappings> = {
      '0x52aa899454998be5b000ad077a46bbe360f4e497': {
        LogOperate: [
          21091850, 21091882, 21091897, 21091915, 21092008, 21092022, 21092039,
          21092142, 21092176, 21092187, 21092230, 21092286, 21092289, 21092295,
          21092319, 21092352, 21092360, 21092368, 21092378, 21092383,
        ],
      },
    };

    Object.entries(eventsToTest).forEach(
      ([poolAddress, events]: [string, EventMappings]) => {
        describe(`Events for ${poolAddress}`, () => {
          beforeEach(() => {
            liquidityProxy = new FluidDexLiquidityProxy(
              dexKey,
              commonAddresses,
              network,
              dexHelper,
              logger,
            );
          });
          Object.entries(events).forEach(
            ([eventName, blockNumbers]: [string, number[]]) => {
              describe(`${eventName}`, () => {
                blockNumbers.forEach((blockNumber: number) => {
                  it(`State after ${blockNumber}`, async function () {
                    await testEventSubscriber(
                      liquidityProxy,
                      liquidityProxy.addressesSubscribed,
                      (_blockNumber: number) =>
                        fetchLiquidityProxyState(liquidityProxy, _blockNumber),
                      blockNumber,
                      `${dexKey}_${poolAddress}`,
                      dexHelper.provider,
                    );
                  });
                });
              });
            },
          );
        });
      },
    );
  });

  describe('Factory events', () => {
    let dexFactory: FluidDexFactory;

    const eventsToTest: Record<Address, EventMappings> = {
      '0x91716C4EDA1Fb55e84Bf8b4c7085f84285c19085': {
        LogDexDeployed: [21105297, 21105362, 21105366, 21105370],
      },
    };

    Object.entries(eventsToTest).forEach(
      ([poolAddress, events]: [string, EventMappings]) => {
        describe(`Events for ${poolAddress}`, () => {
          beforeEach(() => {
            dexFactory = new FluidDexFactory(
              dexKey,
              commonAddresses,
              network,
              dexHelper,
              logger,
              pools => {
                console.log('POOLS: ', pools);
              },
            );
          });
          Object.entries(events).forEach(
            ([eventName, blockNumbers]: [string, number[]]) => {
              describe(`${eventName}`, () => {
                blockNumbers.forEach((blockNumber: number) => {
                  it(`State after ${blockNumber}`, async function () {
                    await testEventSubscriber(
                      dexFactory,
                      dexFactory.addressesSubscribed,
                      (_blockNumber: number) =>
                        dexFactory.generateState(blockNumber),
                      blockNumber,
                      `${dexKey}_${poolAddress}`,
                      dexHelper.provider,
                    );
                  });
                });
              });
            },
          );
        });
      },
    );
  });
});
