/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable functional/prefer-readonly-type */
/* eslint-disable @typescript-eslint/array-type */
/* eslint-disable functional/immutable-data */
/* eslint-disable functional/no-let */
/* eslint-disable prefer-const */
// -------------------------------------------------------------------------------------
// model
// -------------------------------------------------------------------------------------

import * as T from "fp-ts/lib/Task";
import * as TE from "fp-ts/lib/TaskEither";

import { mapAsyncIterable } from "@pagopa/io-functions-commons/dist/src/utils/async";
import { pipe } from "fp-ts/lib/function";

/**
 * @category model
 * @since 2.0.0
 */
export type AsyncIterableTask<A> = T.Task<AsyncIterable<A>>;

export const fromAsyncIterable = <A>(
  a: AsyncIterable<A>
): AsyncIterableTask<A> => T.of(a);

/**
 * `map` can be used to turn functions `(a: A) => B` into functions `(fa: F<A>) => F<B>` whose argument and return types
 * use the type constructor `F` to represent some computational context.
 *
 * @category Functor
 * @since 2.0.0
 */
export const map: <A, B>(
  f: (a: A) => B
) => // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
(fa: AsyncIterableTask<A>) => AsyncIterableTask<B> = f => fa =>
  pipe(
    fa,
    T.map(_ => mapAsyncIterable(_, f))
  );

/**
 * Process an AsyncIterableTask and return an array of results
 */
export const fold = <A>(fa: AsyncIterableTask<A>): T.Task<ReadonlyArray<A>> =>
  pipe(
    fa,
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    T.chain(_ => async () => foldIterableArray<A>(_)())
  );

/**
 * Process an AsyncIterableTask that can fail and return either an error or an array of results
 */
export const foldTaskEither = <E, A>(onError: (err: unknown) => E) => (
  fa: AsyncIterableTask<A>
): TE.TaskEither<E, ReadonlyArray<A>> =>
  pipe(
    fa,
    TE.fromTask,
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    TE.chain(_ => TE.tryCatch(async () => foldIterableArray<A>(_)(), onError))
  );

const foldIterableArray = <A>(_: AsyncIterable<A>) => async () => {
  let array: Array<A> = [];
  for await (const variable of _) {
    array.push(variable);
  }
  return array as ReadonlyArray<A>;
};
