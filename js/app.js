import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot, doc, updateDoc, getDocs, setDoc, getDoc, arrayUnion } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyA47in40_VutzVKQUAV1CUSl6a0SbxDVy0",
  authDomain: "somrido.firebaseapp.com",
  projectId: "somrido",
  storageBucket: "somrido.firebasestorage.app",
  messagingSenderId: "377166664245",
  appId: "1:377166664245:web:f08539e2af77d89275577c",
  measurementId: "G-EWLFGQL1DS"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const membersColl = collection(db, "somrido_members");
const treasuryDocRef = doc(db, "somrido_ledger", "matrix");

let globalActiveUser = null; 
let cachedMembersArray = [];
let activeMemberData = null;

function runAutoMonthEngine() {
    const options = { month: 'long', year: '2-digit' };
    const today = new Date();
    const lbl = document.getElementById('month-label');
    if(lbl) {
        lbl.innerText = `Fund Collection of ${today.toLocaleDateString('en-US', options).replace(' ', "'")}`;
    }
}

// ==========================================
// 🔒 ১. কাস্টম ইউজার আইডি ও পাসওয়ার্ড ম্যাচিং গেটওয়ে
// ==========================================
const loginForm = document.getElementById('login-form');
if(loginForm) {
    loginForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        const userInput = document.getElementById('login-user').value.trim();
        const passInput = document.getElementById('login-pass').value;

        // ডাইনামিক এডমিন পাসওয়ার্ড চেক
        try {
            const adminDoc = await getDoc(doc(db, "system_settings", "admin_auth"));
            let validAdminPass = "12345";
            if(adminDoc.exists() && adminDoc.data().password) {
                validAdminPass = adminDoc.data().password;
            }

            if ((userInput === "admin" || userInput === "admin@somrido.com") && passInput === validAdminPass) {
                setupUIVisibility("Admin", null);
                return;
            }
        } catch(err) {
            console.log("Admin Check Fallback");
        }

        // মেম্বার আইডি ও পাসওয়ার্ড চেক
        try {
            const querySnapshot = await getDocs(membersColl);
            let userFound = false;
            
            querySnapshot.forEach((docSnap) => {
                const mData = docSnap.data();
                if ((mData.userId === userInput || docSnap.id === userInput) && mData.password === passInput) {
                    userFound = true;
                    setupUIVisibility("Member", { id: docSnap.id, ...mData });
                }
            });

            if (!userFound) { 
                const errDiv = document.getElementById('login-error');
                if(errDiv) errDiv.classList.remove('d-none'); 
            }
        } catch (err) { alert("Login Engine Error: " + err.message); }
    });
}

function setupUIVisibility(role, userObj) {
    globalActiveUser = { role: role, data: userObj };
    
    const authCont = document.getElementById('auth-container');
    const dashCont = document.getElementById('dashboard-container');
    if(authCont) authCont.classList.add('d-none');
    if(dashCont) dashCont.classList.remove('d-none');
    
    const roleLbl = document.getElementById('user-role-label');
    if(roleLbl) roleLbl.innerText = role;
    
    if (role === "Admin") {
        const title = document.getElementById('welcome-title');
        if(title) title.innerText = "Somrido Control Room";
        if(roleLbl) roleLbl.className = "badge bg-danger";
        
        ['dashboardTabs', 'treasury-stats-row', 'admin-collection-form-sec', 'net-capital-container'].forEach(id => {
            const el = document.getElementById(id);
            if(el) el.classList.remove('d-none');
        });
        const pView = document.getElementById('personal-member-view');
        if(pView) pView.classList.add('d-none');
    } else {
        const title = document.getElementById('welcome-title');
        if(title) title.innerText = `Welcome, ${userObj.name}`;
        if(roleLbl) roleLbl.className = "badge bg-success";
        
        ['dashboardTabs', 'treasury-stats-row', 'admin-collection-form-sec', 'net-capital-container'].forEach(id => {
            const el = document.getElementById(id);
            if(el) el.classList.add('d-none');
        });
        const pView = document.getElementById('personal-member-view');
        if(pView) pView.classList.remove('d-none');
    }
    
    startRealtimeCloudSync();
}

// ==========================================
// 🔄 ২. রিয়েল-টাইম ডাটাবেজ সিঙ্ক ও ডাটা হাইডিং
// ==========================================
function startRealtimeCloudSync() {
    onSnapshot(treasuryDocRef, (snap) => {
        if (snap.exists() && globalActiveUser && globalActiveUser.role === "Admin") {
            const d = snap.data();
            const cash = document.getElementById('cash-val');
            const bkash = document.getElementById('bkash-val');
            const bank = document.getElementById('bank-val');
            const netCap = document.getElementById('net-capital-val');

            if(cash) cash.innerText = `${parseFloat(d.cash || 0).toFixed(2)} Tk`;
            if(bkash) bkash.innerText = `${parseFloat(d.bkash || 0).toFixed(2)} Tk`;
            if(bank) bank.innerText = `${parseFloat(d.bank || 0).toFixed(2)} Tk`;
            
            let net = (parseFloat(d.cash || 0) + parseFloat(d.bkash || 0) + parseFloat(d.bank || 0)) - parseFloat(d.expense || 0);
            if(netCap) netCap.innerText = `${net.toFixed(2)} Tk`;
        }
    });

    onSnapshot(membersColl, (querySnapshot) => {
        cachedMembersArray = [];
        let totalGlobalFundCollected = 0;
        let totalCurrentMonthCollected = 0;

        const listContainer = document.getElementById('members-list-container');
        const selectDropdown = document.getElementById('collect-member-select');
        const dueTbody = document.getElementById('due-ledger-tbody');
        const personalView = document.getElementById('personal-member-view');

        if (listContainer) listContainer.innerHTML = "";
        if (selectDropdown) selectDropdown.innerHTML = '<option value="">Choose...</option>';
        if (dueTbody) dueTbody.innerHTML = "";
        if (personalView) personalView.innerHTML = "";

        querySnapshot.forEach((docSnap) => {
            const id = docSnap.id;
            const m = docSnap.data();
            cachedMembersArray.push({ id, ...m });

            totalGlobalFundCollected += (parseFloat(m.total_installment_paid || 0) + parseFloat(m.admission_paid || 0));
            totalCurrentMonthCollected += parseFloat(m.total_installment_paid || 0);

            let target = parseFloat(m.installment_target || 0);
            let paid = parseFloat(m.total_installment_paid || 0);
            let outstandingDue = target - paid;

            if (globalActiveUser && globalActiveUser.role === "Admin") {
                if (listContainer) {
                    listContainer.innerHTML += `
                        <div class="col-12 col-md-6 col-lg-4">
                            <div class="member-box text-center">
                                <img src="${m.picture || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150'}" class="profile-img-preview mb-3">
                                <h5 class="fw-bold text-info">${m.name}</h5>
                                <p class="mb-1 small"><b>ID:</b> ${m.userId || id} | <i class="fa-solid fa-phone"></i> ${m.cell || m.phone || 'N/A'}</p>
                                <span class="badge bg-secondary">Target: ${target} Tk</span>
                                <span class="badge bg-success">Paid: ${paid} Tk</span>
                            </div>
                        </div>`;
                }
                if (selectDropdown) selectDropdown.innerHTML += `<option value="${id}">${m.name} (${m.userId || id})</option>`;
                if (dueTbody) {
                    dueTbody.innerHTML += `
                        <tr>
                            <td><h6 class="fw-bold mb-0 text-info">${m.name}</h6><small class="text-muted">ID: ${m.userId || id}</small></td>
                            <td>${m.cell || m.phone || ''}</td>
                            <td>${target} Tk</td>
                            <td class="text-success">${paid} Tk</td>
                            <td><span class="badge bg-danger">${outstandingDue} Tk</span></td>
                            <td class="text-center">
                                <button class="btn btn-success btn-sm send-wa-btn" data-name="${m.name}" data-cell="${m.cell || m.phone}" data-due="${outstandingDue}"><i class="fa-brands fa-whatsapp"></i> Notify</button>
                            </td>
                        </tr>`;
                }
            } 
            else if (globalActiveUser && globalActiveUser.role === "Member" && (globalActiveUser.data.id === id || globalActiveUser.data.userId === m.userId)) {
                if (personalView) {
                    personalView.innerHTML = `
                        <div class="col-12 col-md-4 text-center">
                            <div class="member-box">
                                <img src="${m.picture || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150'}" class="profile-img-preview mb-3">
                                <h4 class="fw-bold text-info">${m.name}</h4>
                                <p class="badge bg-warning text-dark">User ID: ${m.userId || id}</p>
                                <p class="small text-start"><b>Cell:</b> ${m.cell || m.phone || 'N/A'}<br><b>Present Addr:</b> ${m.present_address || m.village || 'N/A'}<br><b>Permanent Addr:</b> ${m.permanent_address || m.district || 'N/A'}</p>
                            </div>
                        </div>
                        <div class="col-12 col-md-8">
                            <div class="row g-3">
                                <div class="col-12 col-sm-6"><div class="matrix-card" style="color:#10b981;">Total Committed Target<br><span class="fs-4">${target.toFixed(2)} Tk</span></div></div>
                                <div class="col-12 col-sm-6"><div class="matrix-card" style="color:#3b82f6;">Total Installment Paid<br><span class="fs-4">${paid.toFixed(2)} Tk</span></div></div>
                                <div class="col-12 col-sm-6"><div class="matrix-card" style="color:#eab308;">Admission Fee Paid<br><span class="fs-4">${parseFloat(m.admission_paid || 0).toFixed(2)} Tk</span></div></div>
                                <div class="col-12 col-sm-6"><div class="matrix-card" style="color:#ef4444;">Current Outstanding Due<br><span class="fs-4">${outstandingDue.toFixed(2)} Tk</span></div></div>
                            </div>
                        </div>`;
                }
                totalGlobalFundCollected = (paid + parseFloat(m.admission_paid || 0));
                totalCurrentMonthCollected = paid;
            }
        });

        const totColl = document.getElementById('total-coll-val');
        const mColl = document.getElementById('month-coll-val');
        if(totColl) totColl.innerText = `${totalGlobalFundCollected.toFixed(2)} Tk`;
        if(mColl) mColl.innerText = `${totalCurrentMonthCollected.toFixed(2)} Tk`;
        attachWhatsAppListener();
    });
}

function attachWhatsAppListener() {
    document.querySelectorAll('.send-wa-btn').forEach(btn => {
        btn.onclick = function() {
            const name = this.getAttribute('data-name');
            let cell = this.getAttribute('data-cell') || '';
            const due = parseFloat(this.getAttribute('data-due'));
            if (due <= 0) return alert("No due outstanding!");
            if (cell && !cell.startsWith('88')) cell = '88' + cell;
            const msg = `Dear ${name},\nThis is an official text from *Somrido Accounts Portal*.\nYour current outstanding installment due is *${due.toFixed(2)} Tk*.\nPlease settle your accounts.\nThank you.`;
            window.open(`https://api.whatsapp.com/send?phone=${cell}&text=${encodeURIComponent(msg)}`, '_blank');
        };
    });
}

// ==========================================
// 🛠️ ৩. এডমিন কন্ট্রোল অ্যান্ড পাসওয়ার্ড ফাংশনালিটি
// ==========================================

// 🔍 মেম্বার সার্চ (S001-S017)
window.searchMember = async function() {
    const searchInput = document.getElementById('searchMemberId');
    if(!searchInput) return;
    const memberId = searchInput.value.trim().toUpperCase();
    if(!memberId) return alert("মেম্বার আইডি লিখুন (যেমন: S001)!");

    try {
        const docRef = doc(db, "members", memberId);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            activeMemberData = docSnap.data();
            document.getElementById('formMemberId').value = memberId;
            document.getElementById('formName').value = activeMemberData.name || '';
            document.getElementById('formPhone').value = activeMemberData.phone || activeMemberData.cell || '';
            document.getElementById('formBlood').value = activeMemberData.blood || '';
            document.getElementById('formPassword').value = activeMemberData.password || '123';
            document.getElementById('formJoinDate').value = activeMemberData.joinDate || '';
            document.getElementById('formStatus').value = activeMemberData.status || 'Active';
            document.getElementById('formVillage').value = activeMemberData.village || '';
            document.getElementById('formThana').value = activeMemberData.thana || '';
            document.getElementById('formDistrict').value = activeMemberData.district || '';
            alert("মেম্বার ডাটা সফলভাবে লোড হয়েছে!");
        } else {
            alert("এই মেম্বার আইডি খুঁজে পাওয়া যায়নি!");
        }
    } catch (e) {
        alert("ডাটা লোড ত্রুটি: " + e.message);
    }
};

// 💾 মেম্বার প্রোফাইল ও পাসওয়ার্ড আপডেট
window.updateMemberProfile = async function(event) {
    if(event) event.preventDefault();
    const memberId = document.getElementById('formMemberId').value;
    if(!memberId) return alert("আগে মেম্বার সার্চ করুন!");

    const docRef = doc(db, "members", memberId);
    try {
        await updateDoc(docRef, {
            name: document.getElementById('formName').value.trim(),
            phone: document.getElementById('formPhone').value.trim(),
            blood: document.getElementById('formBlood').value.trim(),
            password: document.getElementById('formPassword').value.trim(),
            joinDate: document.getElementById('formJoinDate').value.trim(),
            status: document.getElementById('formStatus').value,
            village: document.getElementById('formVillage').value.trim(),
            thana: document.getElementById('formThana').value.trim(),
            district: document.getElementById('formDistrict').value.trim()
        });
        alert("মেম্বার তথ্য ও পাসওয়ার্ড সফলভাবে আপডেট করা হয়েছে!");
    } catch (e) {
        alert("আপডেট ব্যর্থ: " + e.message);
    }
};

// 🔐 এডমিন নিজের পাসওয়ার্ড পরিবর্তন
window.changeAdminPassword = async function(event) {
    if(event) event.preventDefault();
    const newPass = document.getElementById('newAdminPass').value.trim();
    if(!newPass) return alert("পাসওয়ার্ড লিখুন!");

    try {
        await setDoc(doc(db, "system_settings", "admin_auth"), {
            username: "admin",
            password: newPass
        });
        alert("এডমিন পাসওয়ার্ড সফলভাবে পরিবর্তন করা হয়েছে!");
        document.getElementById('newAdminPass').value = '';
    } catch (e) {
        alert("পাসওয়ার্ড সেভ করা যায়নি: " + e.message);
    }
};

// 🚀 S001-S017 Initial Members Setup Generator
window.seedInitialMembers = async function() {
    const list = [
        { id: "S001", name: "Md. Shariful Islam (Shobuz)" },
        { id: "S002", name: "Omer Faruk" },
        { id: "S003", name: "Md. Dulal Hossain PK" },
        { id: "S004", name: "Md. Murad" },
        { id: "S005", name: "Md. Anower Hossain" },
        { id: "S006", name: "Md. Asadul" },
        { id: "S007", name: "Momin Mia" },
        { id: "S008", name: "Ibrahim" },
        { id: "S009", name: "Bulbul Ahmed" },
        { id: "S010", name: "Md. Rasel" },
        { id: "S011", name: "Md. Ronju" },
        { id: "S012", name: "Md. Shahriar Ahmed" },
        { id: "S013", name: "Md. Ashik" },
        { id: "S014", name: "Arman parvez Rafi" },
        { id: "S015", name: "Md. Abdul Monayem" },
        { id: "S016", name: "Md. Kawsar" },
        { id: "S017", name: "Md. Robiul" }
    ];

    try {
        for(let item of list) {
            await setDoc(doc(db, "members", item.id), {
                userId: item.id,
                name: item.name,
                password: "123",
                phone: "",
                blood: "",
                joinDate: "",
                status: "Active",
                village: "",
                thana: "",
                district: "",
                totalSavings: 0,
                welfareDonation: 0,
                totalFundBalance: 0,
                donationBalance: 0,
                transactions: []
            }, { merge: true });
        }
        alert("S001 থেকে S017 মেম্বারদের ডাটা সফলভাবে ডাটাবেসে সেভ হয়েছে!");
    } catch(e) {
        alert("ইনিশিয়ালাইজেশান ত্রুটি: " + e.message);
    }
};

// রেজিস্টার নতুন মেম্বার
const regForm = document.getElementById('member-reg-form');
if (regForm) {
    regForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const uIdInput = document.getElementById('m-userid').value.trim();

        let isDuplicate = cachedMembersArray.some(x => x.userId === uIdInput || uIdInput === "admin");
        if(isDuplicate) {
            return alert("❌ Error: This User ID already exists! Please give a unique ID.");
        }

        const m = {
            picture: document.getElementById('m-pic').value.trim() || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150",
            name: document.getElementById('m-name').value.trim(),
            cell: document.getElementById('m-cell').value.trim(),
            email: document.getElementById('m-email').value.trim(),
            present_address: document.getElementById('m-pres-addr').value.trim(),
            permanent_address: document.getElementById('m-perm-addr').value.trim(),
            installment_target: parseFloat(document.getElementById('m-inst-target').value) || 0,
            admission_paid: parseFloat(document.getElementById('m-adm-paid').value) || 0,
            userId: uIdInput,
            password: document.getElementById('m-pass').value,
            total_installment_paid: 0
        };
        try {
            await addDoc(membersColl, m);
            alert("🎯 Member Registered Successfully with Custom User ID!");
            regForm.reset();
        } catch (err) { alert("Fail: " + err.message); }
    });
}

const collForm = document.getElementById('collection-form');
if (collForm) {
    collForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const mId = document.getElementById('collect-member-select').value;
        const type = document.getElementById('collect-type').value;
        const method = document.getElementById('collect-method').value;
        const amt = parseFloat(document.getElementById('collect-amount').value) || 0;

        try {
            const memberDocRef = doc(db, "somrido_members", mId);
            let targetObj = cachedMembersArray.find(x => x.id === mId);

            if (type === "Installment Fee") {
                await updateDoc(memberDocRef, { total_installment_paid: (targetObj.total_installment_paid || 0) + amt });
            } else if (type === "Admission Fee") {
                await updateDoc(memberDocRef, { admission_paid: (targetObj.admission_paid || 0) + amt });
            }

            let ledger = { cash: 0, bkash: 0, bank: 0 };
            const snap = await getDocs(collection(db, "somrido_ledger"));
            snap.forEach(d => { if(d.id === "matrix") ledger = d.data(); });
            ledger[method] = (ledger[method] || 0) + amt;
            
            await updateDoc(treasuryDocRef, ledger);
            alert("✅ Cloud Treasury Updated!");
            collForm.reset();
        } catch (err) { alert("Error: " + err.message); }
    });
}

const logoutBtn = document.getElementById('logout-btn');
if(logoutBtn) logoutBtn.onclick = function() { location.reload(); };

runAutoMonthEngine();