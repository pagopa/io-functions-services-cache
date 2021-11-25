import { number } from "fp-ts";
import * as E from "fp-ts/lib/Either";
import * as TE from "fp-ts/lib/TaskEither";
import { pipe } from "fp-ts/lib/function";
import { forEach } from "lodash";
import * as AI from "../AsyncIterableTask";

async function* yield123() {
  for (let i = 1; i <= 3; i++) {
    yield i;
  }
}

async function* yieldThrowError() {
  for (let i = 1; i <= 3; i++) {
    if (i < 3) yield i;
    else throw Error("an Error");
  }
}

describe("AsyncIterableTask", () => {
  it("fold - should read all values", async () => {
    const asyncIterable = yield123();
    const asyncIterator = asyncIterable[Symbol.asyncIterator]();

    const res = await pipe(
      asyncIterator,
      AI.fromAsyncIterable,
      AI.map(v => v + 1),
      AI.fold
    )();

    expect(res).toEqual([2, 3, 4]);
  });

  it("flodTaskEither - should process all values", async () => {
    const asyncIterable = yield123();
    const asyncIterator = asyncIterable[Symbol.asyncIterator]();

    let elements = 0;

    const res = await pipe(
      asyncIterator,
      AI.fromAsyncIterable,
      AI.map(v => {
        elements++;
        return v + 2;
      }),
      AI.foldTaskEither(_ => _)
    )();

    expect(elements).toEqual(3);

    pipe(
      res,
      E.map(val => expect(val).toEqual([3, 4, 5])),
      E.mapLeft(_ => fail("Error retrieving values"))
    );
  });

  it("flodTaskEither - should handle Errors", async () => {
    const asyncIterable = yieldThrowError();
    const asyncIterator = asyncIterable[Symbol.asyncIterator]();

    let elements = 0;

    const res = await pipe(
      asyncIterator,
      AI.fromAsyncIterable,
      AI.map(v => {
        elements++;
        return v + 2;
      }),
      AI.foldTaskEither(_ => _)
    )();

    expect(elements).toEqual(2);

    pipe(
      res,
      E.map(val => fail("Exception not handled")),
      E.mapLeft(err => expect(err).toEqual(Error("an Error")))
    );
  });
});
