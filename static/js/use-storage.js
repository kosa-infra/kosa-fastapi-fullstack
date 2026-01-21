console.log("use-storage.js")

// 키 값 변수화
const storageKeys = {
    IS_LOGIN: "isLogin",
    USER_NAME: "userName"
}

Object.freeze(storageKeys)

/**
 * 로컬 스토리지에 저장
 * @param {boolean} isLogin 
 * @param {string} userName 
 */
const setStorage = (isLogin, userName) => {
    localStorage.setItem(storageKeys.IS_LOGIN, isLogin);
    localStorage.setItem(storageKeys.USER_NAME, userName);
}

/**
 * 로컬 스토리지에서 가져오기
 * @returns {Object}
 */
const getStorage = () => {
    const isLogin = localStorage.getItem(storageKeys.IS_LOGIN);
    const userName = localStorage.getItem(storageKeys.USER_NAME);
    console.log('로그인 여부 :', isLogin, '사용자 명:', userName);
    return { isLogin, userName };
}

/**
 * 로컬 스토리지 비우기
 */
const removeStorage = () => {
    Object.values(storageKeys).forEach(key => {
        localStorage.removeItem(key);
    })

    // 모든 스토리지 비우기
    // localStorage.clear()
}



const login = async () => {
    const response = await fetch('/api/data')

    if (response.isLogin) {
        setStorage(data.response, response.userName)

        // 이후 액션
    } else {
        removeStorage();
        window.alert('error!')
    }

}

const logout = async () => {
    removeStorage();
}
