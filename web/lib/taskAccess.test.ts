import { describe, it, expect } from 'vitest'
import { canAccessTask } from './taskAccess'

const op = { userId: 'op-1', role: 'operator' }
const stu = { userId: 'stu-1', role: 'student' }
const otherStu = { userId: 'stu-2', role: 'student' }

describe('canAccessTask', () => {
  it('运营可访问任意任务（含学员创建的）', () => {
    expect(canAccessTask({ createdBy: 'stu-1' }, op)).toBe(true)
    expect(canAccessTask({ createdBy: 'op-2' }, op)).toBe(true)
  })

  it('运营可访问 createdBy 为空的历史任务', () => {
    expect(canAccessTask({ createdBy: null }, op)).toBe(true)
  })

  it('学员只能访问自己创建的', () => {
    expect(canAccessTask({ createdBy: 'stu-1' }, stu)).toBe(true)
    expect(canAccessTask({ createdBy: 'stu-1' }, otherStu)).toBe(false)
  })

  it('学员访问 createdBy 为空的历史任务 → 拒绝（无法证明归属）', () => {
    expect(canAccessTask({ createdBy: null }, stu)).toBe(false)
  })

  it('任务不存在 → 拒绝（运营也一样）', () => {
    expect(canAccessTask(null, op)).toBe(false)
    expect(canAccessTask(undefined, op)).toBe(false)
    expect(canAccessTask(null, stu)).toBe(false)
  })

  it('未知角色按非运营处理', () => {
    expect(canAccessTask({ createdBy: 'x' }, { userId: 'x', role: 'assistant' })).toBe(true)
    expect(canAccessTask({ createdBy: 'y' }, { userId: 'x', role: 'assistant' })).toBe(false)
  })
})
