// Standard Schema 執行器：同步 / 非同步 / 非原生 thenable 三種回傳，與 issue 的 path 前綴

import { describe, expect, it } from 'vitest'

import { runStandard } from '../src/schema/standard-schema.js'

import type { StandardSchemaV1 } from '../src/schema/standard-schema.js'

function schemaOf<T>(validate: StandardSchemaV1<unknown, T>['~standard']['validate']): StandardSchemaV1<unknown, T> {
  return { '~standard': { version: 1, vendor: 'test', validate } }
}

describe('runStandard', () => {
  it('同步回傳成功值', async () => {
    const schema = schemaOf<number>((value) => ({ value: Number(value) }))
    await expect(runStandard(schema, '42')).resolves.toEqual({ value: 42 })
  })

  it('非同步（Promise）回傳成功值', async () => {
    const schema = schemaOf<number>(async (value) => ({ value: Number(value) }))
    await expect(runStandard(schema, '42')).resolves.toEqual({ value: 42 })
  })

  it('非原生 thenable 也等到解析（instanceof Promise 判不到、會把未解析結果當成功值放行）', async () => {
    const thenable = {
      then(onFulfilled: (v: { value: number }) => void) {
        onFulfilled({ value: 7 })
      },
    }
    const schema = schemaOf<number>(() => thenable as never)
    await expect(runStandard(schema, null)).resolves.toEqual({ value: 7 })
  })

  it('issue 帶 path → 前綴欄位路徑，多欄位失敗時可定位', async () => {
    const schema = schemaOf(() => ({
      issues: [
        { message: 'Required', path: ['title'] },
        { message: 'Required', path: ['author', 'name'] },
      ],
    }))
    await expect(runStandard(schema, {})).resolves.toEqual({
      issues: ['title: Required', 'author.name: Required'],
    })
  })

  it('path 為物件段（PathSegment）取其 key', async () => {
    const schema = schemaOf(() => ({ issues: [{ message: 'bad', path: [{ key: 'items' }, { key: 0 }] }] }))
    await expect(runStandard(schema, {})).resolves.toEqual({ issues: ['items.0: bad'] })
  })

  it('issue 無 path → 只留 message', async () => {
    const schema = schemaOf(() => ({ issues: [{ message: 'Invalid input' }] }))
    await expect(runStandard(schema, {})).resolves.toEqual({ issues: ['Invalid input'] })
  })
})
