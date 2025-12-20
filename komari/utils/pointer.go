package utils

// Ptr 返回任意值的指针（便捷生成 *T）
func Ptr[T any](v T) *T { return &v }
