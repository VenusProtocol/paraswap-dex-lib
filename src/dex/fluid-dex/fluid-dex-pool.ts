import { Interface } from '@ethersproject/abi';
import { DeepReadonly } from 'ts-essentials';
import { Log, Logger } from '../../types';
import { catchParseLogError } from '../../utils';
import { StatefulEventSubscriber } from '../../stateful-event-subscriber';
import { IDexHelper } from '../../dex-helper/idex-helper';
import ResolverABI from '../../abi/fluid-dex/resolver.abi.json';
import LiquidityABI from '../../abi/fluid-dex/liquidityUserModule.abi.json';
import {
  commonAddresses,
  FluidDexPool,
  FluidDexPoolState,
  PoolWithReserves,
} from './types';
import { MultiResult, MultiCallParams } from '../../lib/multi-wrapper';
import { BytesLike } from 'ethers/lib/utils';
import { Address } from '../../types';
import { generalDecoder } from '../../lib/decoders';

export class FluidDexEventPool extends StatefulEventSubscriber<FluidDexPoolState> {
  handlers: {
    [event: string]: (
      event: any,
      state: DeepReadonly<FluidDexPoolState>,
      log: Readonly<Log>,
    ) => Promise<DeepReadonly<FluidDexPoolState> | null>;
  } = {};

  logDecoder: (log: Log) => any;

  addressesSubscribed: Address[];
  protected liquidityIface = new Interface(LiquidityABI);

  constructor(
    readonly parentName: string,
    readonly pool: Address,
    readonly commonAddresses: commonAddresses,
    protected network: number,
    protected dexHelper: IDexHelper,
    logger: Logger,
  ) {
    super(parentName, 'FluidDex_' + pool, dexHelper, logger);

    this.logDecoder = (log: Log) => this.liquidityIface.parseLog(log);
    this.addressesSubscribed = [commonAddresses.liquidityProxy];

    // Add handlers
    this.handlers['LogOperate'] = this.handleOperate.bind(this);
  }

  /**
   * Handle a trade rate change on the pool.
   */
  async handleOperate(
    event: any,
    state: DeepReadonly<FluidDexPoolState>,
    log: Readonly<Log>,
  ): Promise<DeepReadonly<FluidDexPoolState> | null> {
    const resolverAbi = new Interface(ResolverABI);
    if (!(event.args.user in [this.pool])) {
      return null;
    }
    const callData: MultiCallParams<PoolWithReserves>[] = [
      {
        target: this.commonAddresses.resolver,
        callData: resolverAbi.encodeFunctionData('getPoolReserves', [
          this.pool,
        ]),
        decodeFunction: await this.decodePoolWithReserves,
      },
    ];

    const results: PoolWithReserves[] =
      await this.dexHelper.multiWrapper.aggregate<PoolWithReserves>(
        callData,
        await this.dexHelper.provider.getBlockNumber(),
        this.dexHelper.multiWrapper.defaultBatchSize,
      );

    const generatedState = {
      collateralReserves: results[0].collateralReserves,
      debtReserves: results[0].debtReserves,
      fee: results[0].fee,
    };

    this.setState(
      generatedState,
      await this.dexHelper.provider.getBlockNumber(),
    );

    return generatedState;
  }

  decodePoolWithReserves = (
    result: MultiResult<BytesLike> | BytesLike,
  ): PoolWithReserves => {
    return generalDecoder(
      result,
      [
        'tuple(address pool, address token0_, address token1_, uint256 fee,' +
          'tuple(uint256 token0RealReserves, uint256 token1RealReserves, uint256 token0ImaginaryReserves, uint256 token1ImaginaryReserves) collateralReserves, ' +
          'tuple(uint256 token0Debt, uint256 token1Debt, uint256 token0RealReserves, uint256 token1RealReserves, uint256 token0ImaginaryReserves, uint256 token1ImaginaryReserves) debtReserves)',
      ],
      undefined,
      decoded => {
        const [decodedResult] = decoded;
        return {
          pool: decodedResult.pool,
          token0_: decodedResult.token0_,
          token1_: decodedResult.token1_,
          fee: decodedResult.fee,
          collateralReserves: {
            token0RealReserves: BigInt(
              decodedResult.collateralReserves.token0RealReserves,
            ),
            token1RealReserves: BigInt(
              decodedResult.collateralReserves.token1RealReserves,
            ),
            token0ImaginaryReserves: BigInt(
              decodedResult.collateralReserves.token0ImaginaryReserves,
            ),
            token1ImaginaryReserves: BigInt(
              decodedResult.collateralReserves.token1ImaginaryReserves,
            ),
          },
          debtReserves: {
            token0Debt: BigInt(decodedResult.debtReserves.token0Debt),
            token1Debt: BigInt(decodedResult.debtReserves.token1Debt),
            token0RealReserves: BigInt(
              decodedResult.debtReserves.token0RealReserves,
            ),
            token1RealReserves: BigInt(
              decodedResult.debtReserves.token1RealReserves,
            ),
            token0ImaginaryReserves: BigInt(
              decodedResult.debtReserves.token0ImaginaryReserves,
            ),
            token1ImaginaryReserves: BigInt(
              decodedResult.debtReserves.token1ImaginaryReserves,
            ),
          },
        };
      },
    );
  };

  /**
   * The function is called every time any of the subscribed
   * addresses release log. The function accepts the current
   * state, updates the state according to the log, and returns
   * the updated state.
   * @param state - Current state of event subscriber
   * @param log - Log released by one of the subscribed addresses
   * @returns Updates state of the event subscriber after the log
   */
  async processLog(
    state: DeepReadonly<FluidDexPoolState>,
    log: Readonly<Log>,
  ): Promise<DeepReadonly<FluidDexPoolState> | null> {
    try {
      const event = this.logDecoder(log);
      if (event.name in this.handlers) {
        return await this.handlers[event.name](event, state, log);
      }
    } catch (e) {
      catchParseLogError(e, this.logger);
    }

    return null;
  }

  async getStateOrGenerate(
    blockNumber: number,
    readonly: boolean = false,
  ): Promise<FluidDexPoolState> {
    let state = this.getState(blockNumber);
    if (!state) {
      state = await this.generateState(blockNumber);
      if (!readonly) this.setState(state, blockNumber);
    }
    return state;
  }

  /**
   * The function generates state using on-chain calls. This
   * function is called to regenerate state if the event based
   * system fails to fetch events and the local state is no
   * more correct.
   * @param blockNumber - Blocknumber for which the state should
   * should be generated
   * @returns state of the event subscriber at blocknumber
   */
  async generateState(
    blockNumber: number,
  ): Promise<DeepReadonly<FluidDexPoolState>> {
    const resolverAbi = new Interface(ResolverABI);
    const callData: MultiCallParams<PoolWithReserves>[] = [
      {
        target: this.commonAddresses.resolver,
        callData: resolverAbi.encodeFunctionData('getPoolReserves', [
          this.pool,
        ]),
        decodeFunction: await this.decodePoolWithReserves,
      },
    ];

    const results: PoolWithReserves[] =
      await this.dexHelper.multiWrapper.aggregate<PoolWithReserves>(
        callData,
        blockNumber,
        this.dexHelper.multiWrapper.defaultBatchSize,
      );

    return {
      collateralReserves: results[0].collateralReserves,
      debtReserves: results[0].debtReserves,
      fee: results[0].fee,
    };
  }
}
