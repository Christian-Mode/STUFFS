# Security Specification for Nexus Factory

## 1. Data Invariants
- All documents must belong to the user who created them (`userId` must match `request.auth.uid`).
- Documents cannot be accessed by anyone other than the owner.
- Document IDs must be valid strings with a maximum length of 128 characters.
- Timestamps (`createdAt`, `publishedAt`) must be set using `request.time`.
- `userId` is immutable after creation.
- `status` transitions are restricted (e.g., `Concept` status only moves from `pending` to `scripted`).

## 2. The "Dirty Dozen" Payloads (Deny List)
1. **Identity Theft**: Create a trend with another user's ID.
2. **Ghost Write**: Update `userId` of an existing post.
3. **ID Poisoning**: Use a 2KB string as a trend ID.
4. **Shadow Field**: Add `isAdmin: true` to a user profile (though we don't have user profiles specifically yet, we protect against extra keys).
5. **PII Leak**: Try to read another user's posts.
6. **Time Travel**: Set `createdAt` to a date in 1999.
7. **Type Bomb**: Set `growth` to a string instead of a number.
8. **Size Attack**: Post a caption that is 1MB in size.
9. **State Shortcut**: Update a concept status directly to `published` (if that were a terminal state, but here it's `scripted`).
10. **Orphaned Write**: Create a concept referencing a trend ID that doesn't exist.
11. **Mass Extraction**: List all trends in the system without a `userId` filter.
12. **Array Overflow**: Add 10,000 hashtags to a post.

## 3. Test Runner (Draft)
I will implement tests that verify these constraints in the security rules.
