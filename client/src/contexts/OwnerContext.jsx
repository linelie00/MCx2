/**
 * OwnerContext — 앱 전역 오너(쓰기 권한) 상태
 * 갤러리/플레이리스트 등에서 useOwner()로 isOwner를 확인하고 잠금/해제한다.
 */
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import * as ownerAuth from '../services/ownerAuth';

const OwnerContext = createContext(null);

const OWNER_LABELS = { matiam: '마티암오너', migel: '미겔오너' };

export function OwnerProvider({ children }) {
  const [owner, setOwner] = useState(() => ownerAuth.getOwner());

  const unlock = useCallback(async (key) => {
    const o = await ownerAuth.verify(key); // 실패 시 throw
    ownerAuth.store(key, o);
    setOwner(o);
    return o;
  }, []);

  const lock = useCallback(() => {
    ownerAuth.clear();
    setOwner(null);
  }, []);

  const value = useMemo(
    () => ({ owner, ownerLabel: owner ? OWNER_LABELS[owner] || owner : null, isOwner: !!owner, unlock, lock }),
    [owner, unlock, lock]
  );

  return <OwnerContext.Provider value={value}>{children}</OwnerContext.Provider>;
}

export const useOwner = () => useContext(OwnerContext);
