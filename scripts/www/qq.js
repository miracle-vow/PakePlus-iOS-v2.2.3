// ==================== QQ 应用逻辑（独立文件） ====================

let qqGeneratedVerificationCode = '';
let qqVerificationCodeExpiry = 0;
let qqSelectedUserPhone = '';

async function showQQPage() {
    const hasRegisteredUser = await checkQQRegistration();
    if (!hasRegisteredUser) {
        await showQQRegisterPage();
    } else {
        await openQQHomePage();
    }
}

async function checkQQRegistration() {
    const users = await db.characters.where('type').equals('user').toArray();
    return users.some(user => user?.identity?.qq_registered && user?.identity?.qq_number);
}

async function showQQRegisterPage() {
    const registerPage = document.getElementById('qq-register-page');
    const userSelect = document.getElementById('qq-register-user-select');
    if (!registerPage || !userSelect) return;

    userSelect.innerHTML = '<option value="">-- 请选择User档案 --</option>';

    const users = await db.characters.where('type').equals('user').toArray();
    if (!users.length) {
        showToast('请先创建User档案');
        return;
    }

    users.forEach(user => {
        const option = document.createElement('option');
        option.value = user.id;
        option.textContent = user.name;
        userSelect.appendChild(option);
    });

    document.getElementById('qq-register-phone-input').value = '';
    document.getElementById('qq-register-code-input').value = '';
    document.getElementById('qq-register-password-input').value = '';
    document.getElementById('qq-register-code-message').textContent = '';
    document.getElementById('qq-register-phone-hint').style.display = 'none';

    qqGeneratedVerificationCode = '';
    qqVerificationCodeExpiry = 0;
    qqSelectedUserPhone = '';

    registerPage.style.display = 'flex';
}

function onQQRegisterUserChange() {
    const selectElem = document.getElementById('qq-register-user-select');
    const selectedUserId = selectElem?.value;
    const phoneInput = document.getElementById('qq-register-phone-input');
    const phoneHint = document.getElementById('qq-register-phone-hint');

    if (!selectedUserId) {
        if (phoneInput) phoneInput.value = '';
        if (phoneHint) phoneHint.style.display = 'none';
        qqSelectedUserPhone = '';
        return;
    }

    db.characters.get(parseInt(selectedUserId)).then(user => {
        if (user && user.identity && user.identity.phone) {
            qqSelectedUserPhone = user.identity.phone;
            if (phoneInput) phoneInput.value = qqSelectedUserPhone;
            if (phoneHint) phoneHint.style.display = 'block';
        } else {
            qqSelectedUserPhone = '';
            if (phoneInput) phoneInput.value = '';
            if (phoneHint) phoneHint.style.display = 'none';
            showToast('该User档案未填写手机号');
        }
    });
}

async function sendQQRegisterCode() {
    const selectedUserId = document.getElementById('qq-register-user-select')?.value;
    const phoneInput = document.getElementById('qq-register-phone-input')?.value?.trim() || '';
    const codeBtn = document.getElementById('qq-register-code-btn');
    const codeMessage = document.getElementById('qq-register-code-message');

    if (!selectedUserId) return showToast('请先选择User档案');
    if (!phoneInput) return showToast('请输入手机号');
    if (!qqSelectedUserPhone || phoneInput !== qqSelectedUserPhone) return showToast('只能输入该User档案中的手机号');

    qqGeneratedVerificationCode = String(Math.floor(100000 + Math.random() * 900000));
    qqVerificationCodeExpiry = Date.now() + 5 * 60 * 1000;

    let countdown = 60;
    if (codeBtn) {
        codeBtn.disabled = true;
        codeBtn.style.background = '#d7d7d7';
        codeBtn.style.color = '#777';
        codeBtn.style.cursor = 'not-allowed';
    }

    const timer = setInterval(() => {
        countdown--;
        if (codeBtn) codeBtn.textContent = `${countdown}s`;
        if (countdown <= 0) {
            clearInterval(timer);
            if (codeBtn) {
                codeBtn.disabled = false;
                codeBtn.style.background = '#111';
                codeBtn.style.color = '#fff';
                codeBtn.style.cursor = 'pointer';
                codeBtn.textContent = '获取验证码';
            }
        }
    }, 1000);

    if (codeMessage) {
        codeMessage.style.color = '#666';
        codeMessage.textContent = '验证码已发送';
    }

    await sendVerificationCodeMessage(parseInt(selectedUserId), qqGeneratedVerificationCode);
}

function generateRandomQQNumber() {
    const len = Math.random() < 0.7 ? 9 : 10;
    const first = Math.floor(Math.random() * 9) + 1;
    let rest = '';
    for (let i = 1; i < len; i++) rest += Math.floor(Math.random() * 10);
    return String(first) + rest;
}

async function submitQQRegister() {
    const selectedUserId = document.getElementById('qq-register-user-select')?.value;
    const phoneInput = document.getElementById('qq-register-phone-input')?.value?.trim() || '';
    const codeInput = document.getElementById('qq-register-code-input')?.value?.trim() || '';
    const passwordInput = document.getElementById('qq-register-password-input')?.value?.trim() || '';

    if (!selectedUserId) return showToast('请选择User档案');
    if (!phoneInput) return showToast('请输入手机号');
    if (!qqSelectedUserPhone || phoneInput !== qqSelectedUserPhone) return showToast('只能输入该User档案中的手机号');
    if (!codeInput) return showToast('请输入验证码');
    if (Date.now() > qqVerificationCodeExpiry) return showToast('验证码已过期，请重新获取');
    if (codeInput !== qqGeneratedVerificationCode) return showToast('验证码错误');
    if (!passwordInput) return showToast('请设置密码');
    if (passwordInput.length < 8) return showToast('密码长度至少8位');

    const userIdNum = parseInt(selectedUserId);
    const user = await db.characters.get(userIdNum);
    if (!user) return showToast('User档案不存在');

    const qqNumber = generateRandomQQNumber();
    const updatedIdentity = {
        ...(user.identity || {}),
        phone: phoneInput,
        qq_password: passwordInput,
        qq_number: qqNumber,
        qq_registered: true,
        qq_registered_at: Date.now()
    };

    await db.characters.update(userIdNum, { identity: updatedIdentity });

    document.getElementById('qq-register-page').style.display = 'none';
    qqGeneratedVerificationCode = '';
    qqVerificationCodeExpiry = 0;
    qqSelectedUserPhone = '';

    showToast(`QQ注册成功，QQ号：${qqNumber}`);
    await openQQHomePage();
}

async function getCurrentQQIdentityUser() {
    const users = await db.characters.where('type').equals('user').toArray();
    return users.find(user => user?.identity?.qq_registered && user?.identity?.qq_number) || null;
}

function getQQTabTemplate(tab, user) {
    const qqNumber = user.identity?.qq_number || '未分配';
    const baseCard = 'background:#fff; border:1px solid #efefef; border-radius:12px; padding:14px; margin-bottom:10px;';

    if (tab === 'contacts') {
        return `
            <div style="${baseCard}">
                <div style="font-size:14px; font-weight:600; color:#222; margin-bottom:6px;">我的联系人</div>
                <div style="font-size:13px; color:#666; line-height:1.7;">当前账号：${qqNumber}</div>
                <div style="font-size:13px; color:#666; line-height:1.7;">当前人设：${user.name || '未知User'}</div>
            </div>
            <div style="${baseCard}">
                <div style="font-size:13px; color:#999; line-height:1.8;">白色INS简约风 · QQ布局模拟页面</div>
            </div>
        `;
    }

    if (tab === 'channels') {
        return `
            <div style="${baseCard}">
                <div style="font-size:14px; font-weight:600; color:#222; margin-bottom:6px;">频道广场</div>
                <div style="font-size:13px; color:#666; line-height:1.8;">这里展示频道内容（模拟QQ频道）。</div>
            </div>
        `;
    }

    if (tab === 'addressbook') {
        return `
            <div style="${baseCard}">
                <div style="font-size:14px; font-weight:600; color:#222; margin-bottom:6px;">通讯录</div>
                <div style="font-size:13px; color:#666; line-height:1.8;">绑定手机号：${user.identity?.phone || '未设置'}</div>
                <div style="font-size:13px; color:#666; line-height:1.8;">QQ号：${qqNumber}</div>
            </div>
        `;
    }

    return `
        <div style="${baseCard}">
            <div style="font-size:14px; font-weight:600; color:#222; margin-bottom:6px;">动态</div>
            <div style="font-size:13px; color:#666; line-height:1.8;">这里展示动态流（模拟QQ动态）。</div>
        </div>
    `;
}

function switchQQTab(tab) {
    const content = document.getElementById('qq-main-content');
    if (!content || !window._qqCurrentUser) return;

    document.querySelectorAll('#qq-tabbar .qq-tab-item').forEach(item => {
        const isActive = item.getAttribute('data-tab') === tab;
        item.classList.toggle('active', isActive);
        item.style.color = isActive ? '#111' : '#999';
    });

    content.innerHTML = getQQTabTemplate(tab, window._qqCurrentUser);
    window._qqCurrentTab = tab;
}

function qqTopAddAction() {
    showToast('QQ加号菜单（可继续扩展）');
}

function openQQSideDrawer() {
    const overlay = document.getElementById('qq-side-overlay');
    const drawer = document.getElementById('qq-side-drawer');
    if (!overlay || !drawer) return;

    overlay.style.display = 'block';
    drawer.style.display = 'block';
    requestAnimationFrame(() => {
        drawer.style.transform = 'translateX(0)';
    });
}

function closeQQSideDrawer() {
    const overlay = document.getElementById('qq-side-overlay');
    const drawer = document.getElementById('qq-side-drawer');
    if (!overlay || !drawer) return;

    drawer.style.transform = 'translateX(-100%)';
    setTimeout(() => {
        overlay.style.display = 'none';
        drawer.style.display = 'none';
    }, 240);
}

async function openQQHomePage() {
    const qqPage = document.getElementById('qq-page');
    const topName = document.getElementById('qq-top-name');
    const topAvatar = document.getElementById('qq-top-avatar');
    const sideName = document.getElementById('qq-side-name');
    const sideAvatar = document.getElementById('qq-side-avatar');
    const sideSign = document.getElementById('qq-side-sign');
    const content = document.getElementById('qq-main-content');
    if (!qqPage || !topName || !topAvatar || !content) return;

    const user = await getCurrentQQIdentityUser();
    if (!user) {
        qqPage.style.display = 'none';
        return showQQRegisterPage();
    }

    window._qqCurrentUser = user;
    window._qqCurrentTab = 'contacts';

    const avatar = user.avatar || user.avatarUrl || '';
    topName.textContent = user.name || 'QQ';
    topAvatar.style.backgroundImage = avatar ? `url(${avatar})` : '';

    if (sideName) sideName.textContent = user.name || 'QQ用户';
    if (sideAvatar) sideAvatar.style.backgroundImage = avatar ? `url(${avatar})` : '';
    if (sideSign) sideSign.textContent = user.identity?.signature || '人类的悲喜即使是天使也无法承受';

    qqPage.style.display = 'flex';
    closeQQSideDrawer();
    switchQQTab('contacts');
}

function hideQQPage() {
    closeQQSideDrawer();
    const qqPage = document.getElementById('qq-page');
    if (qqPage) qqPage.style.display = 'none';
}

function cancelQQRegister() {
    const page = document.getElementById('qq-register-page');
    if (page) page.style.display = 'none';
    qqGeneratedVerificationCode = '';
    qqVerificationCodeExpiry = 0;
    qqSelectedUserPhone = '';
}
