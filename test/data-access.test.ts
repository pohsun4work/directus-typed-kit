// data-access runtime 測試：service 工廠 key ↔ collection 名反推
// Pascal 吃掉底線後 regex 無損不了，須靠 schema 真實 collection 名比對

import { describe, expect, it } from 'vitest'

import { collectionToServiceKey, serviceKeyToCollection } from '../src/data-access/directus-services.js'

describe('serviceKeyToCollection', () => {
  it('有 schema collection 名時無損還原（含數字段 / 單字母段）', () => {
    const collections = ['file_tags', 'user_2fa', 'a_b_c']
    expect(serviceKeyToCollection('FileTagsService', collections)).toBe('file_tags')
    expect(serviceKeyToCollection('User2faService', collections)).toBe('user_2fa')
    expect(serviceKeyToCollection('ABCService', collections)).toBe('a_b_c')
  })

  it('forward key 與型別層 Pascal 對齊', () => {
    expect(collectionToServiceKey('file_tags')).toBe('FileTagsService')
    expect(collectionToServiceKey('user_2fa')).toBe('User2faService')
    expect(collectionToServiceKey('a_b_c')).toBe('ABCService')
  })

  it('無 schema 時退回 regex 盡力反推（單字段仍正確）', () => {
    expect(serviceKeyToCollection('FileTagsService')).toBe('file_tags')
    expect(serviceKeyToCollection('ArticlesService')).toBe('articles')
  })
})
