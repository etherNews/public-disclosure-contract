import React, { useState, useEffect } from 'react';
import Web3 from 'web3';
import PublicDisclosureContract from './contracts/PublicDisclosure.json';
import './App.css';

function App() {
  const [web3, setWeb3] = useState(null);
  const [account, setAccount] = useState('');
  const [contract, setContract] = useState(null);
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [formData, setFormData] = useState({
    title: '',
    content: '',
    link: '',
    fee: '0.01'
  });
  const [removePostId, setRemovePostId] = useState('');
  const [paymentReceiver, setPaymentReceiver] = useState('');
  const [removeFee, setRemoveFee] = useState('');
  const [renewPostId, setRenewPostId] = useState('');
  const [renewFee, setRenewFee] = useState('');
  const [showCleanupButton, setShowCleanupButton] = useState(false);
  const [cleanupInProgress, setCleanupInProgress] = useState(false);

  useEffect(() => {
    const init = async () => {
      // Connect to Web3
      if (window.ethereum) {
        try {
          await window.ethereum.request({ method: 'eth_requestAccounts' });
          const web3Instance = new Web3(window.ethereum);
          setWeb3(web3Instance);
          
          const accounts = await web3Instance.eth.getAccounts();
          setAccount(accounts[0]);
          
          // Load contract
          const networkId = await web3Instance.eth.net.getId();
          const deployedNetwork = PublicDisclosureContract.networks[networkId];
          const contractInstance = new web3Instance.eth.Contract(
            PublicDisclosureContract.abi,
            deployedNetwork && deployedNetwork.address
          );
          
          setContract(contractInstance);
          
          // Check if user is admin to show cleanup button
          const admin = await contractInstance.methods.admin().call();
          setShowCleanupButton(accounts[0].toLowerCase() === admin.toLowerCase());
          
          loadPosts(contractInstance, 0);
        } catch (error) {
          console.error("Could not connect to wallet", error);
        }
      } else {
        alert("메타마스크를 설치해주세요!");
      }
    };
    
    init();
  }, []);

  const loadPosts = async (contractInstance, page) => {
    setLoading(true);
    try {
      // Get paginated active post IDs
      const result = await contractInstance.methods.getActivePostIds(page).call();
      const activePostIds = result[0];
      const totalPages = parseInt(result[1]);
      setTotalPages(totalPages);
      
      if (activePostIds.length === 0) {
        setPosts([]);
        setLoading(false);
        return;
      }
      
      // Get posts data in batch
      const batchData = await contractInstance.methods.getPostsBatch(activePostIds).call();
      
      // Get post content for each post (separate call to save gas)
      const contentPromises = activePostIds.map(id => 
        contractInstance.methods.getPostContent(id).call()
      );
      const contents = await Promise.all(contentPromises);
      
      // Combine the data
      const postsData = activePostIds.map((id, index) => ({
        id,
        author: batchData.authors[index],
        title: batchData.titles[index],
        content: contents[index].content,
        link: contents[index].link,
        publicationFee: web3.utils.fromWei(batchData.fees[index], 'ether'),
        expiryTime: new Date(batchData.expiryTimes[index] * 1000).toLocaleString(),
        isActive: batchData.activeStates[index]
      }));
      
      // Sort by fee (highest first)
      postsData.sort((a, b) => parseFloat(b.publicationFee) - parseFloat(a.publicationFee));
      
      setPosts(postsData);
    } catch (error) {
      console.error("Error loading posts", error);
    }
    setLoading(false);
  };

  const handlePageChange = (newPage) => {
    setCurrentPage(newPage);
    loadPosts(contract, newPage);
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData({ ...formData, [name]: value });
  };

  const handlePublishPost = async (e) => {
    e.preventDefault();
    
    try {
      const { title, content, link, fee } = formData;
      const weiValue = web3.utils.toWei(fee, 'ether');
      
      await contract.methods.publishPost(title, content, link)
        .send({ from: account, value: weiValue });
      
      // Reset form
      setFormData({
        title: '',
        content: '',
        link: '',
        fee: '0.01'
      });
      
      // Reload posts
      loadPosts(contract, currentPage);
    } catch (error) {
      console.error("Error publishing post", error);
    }
  };

  const handleRemovePost = async (e) => {
    e.preventDefault();
    
    try {
      const weiValue = web3.utils.toWei(removeFee, 'ether');
      
      await contract.methods.removePost(removePostId, paymentReceiver)
        .send({ from: account, value: weiValue });
      
      // Reset form
      setRemovePostId('');
      setPaymentReceiver('');
      setRemoveFee('');
      
      // Reload posts
      loadPosts(contract, currentPage);
    } catch (error) {
      console.error("Error removing post", error);
    }
  };

  const handleRenewPost = async (e) => {
    e.preventDefault();
    
    try {
      const weiValue = web3.utils.toWei(renewFee, 'ether');
      
      await contract.methods.renewPost(renewPostId)
        .send({ from: account, value: weiValue });
      
      // Reset form
      setRenewPostId('');
      setRenewFee('');
      
      // Reload posts
      loadPosts(contract, currentPage);
    } catch (error) {
      console.error("Error renewing post", error);
    }
  };

  const handleCleanupExpired = async () => {
    try {
      setCleanupInProgress(true);
      
      // Cleanup up to 20 expired posts at once
      await contract.methods.cleanupExpiredPosts(20)
        .send({ from: account });
      
      // Reload posts
      loadPosts(contract, currentPage);
      
      setCleanupInProgress(false);
    } catch (error) {
      console.error("Error cleaning up posts", error);
      setCleanupInProgress(false);
    }
  };

  const donateToAuthor = async (authorAddress, amount) => {
    try {
      const weiValue = web3.utils.toWei(amount, 'ether');
      
      await web3.eth.sendTransaction({
        from: account,
        to: authorAddress,
        value: weiValue
      });
      
      alert("후원이 성공적으로 완료되었습니다!");
    } catch (error) {
      console.error("Error sending donation", error);
    }
  };

  // 현재 연결된 주소를 짧게 표시하는 함수
  const shortenAddress = (address) => {
    return address ? `${address.substring(0, 6)}...${address.substring(address.length - 4)}` : '';
  };

  return (
    <div className="App">
      <header className="App-header">
        <div className="header-content">
          <h1>공익 정보 공개 플랫폼</h1>
          <p className="subtitle">블록체인 기반 투명한 정보 공개 시스템</p>
        </div>
        <div className="header-account">
          {account && (
            <div className="account-info">
              <span className="account-label">지갑 연결됨</span>
              <span className="account-address">{shortenAddress(account)}</span>
            </div>
          )}
          {showCleanupButton && (
            <button 
              onClick={handleCleanupExpired}
              disabled={cleanupInProgress}
              className="cleanup-button"
            >
              {cleanupInProgress ? "처리 중..." : "만료된 게시물 정리"}
            </button>
          )}
        </div>
      </header>
      
      <div className="platform-intro">
        <div className="intro-content">
          <h2>공익 정보 공개 플랫폼이란?</h2>
          <p>공익을 위한 정보를 이더리움 블록체인에 안전하게 기록하고 공유하는 서비스입니다. 게시된 정보는 검열이 불가능하며, 영구적으로 보존됩니다.</p>
          <div className="intro-features">
            <div className="feature">
              <div className="feature-icon">📝</div>
              <h3>정보 게시</h3>
              <p>최소 0.01 ETH로 1년간 정보를 공개할 수 있습니다.</p>
            </div>
            <div className="feature">
              <div className="feature-icon">🔄</div>
              <h3>정보 갱신</h3>
              <p>기간 만료 시 동일 비용으로 1년 연장 가능합니다.</p>
            </div>
            <div className="feature">
              <div className="feature-icon">❌</div>
              <h3>정보 삭제</h3>
              <p>2배의 비용을 지불하면 정보를 삭제할 수 있습니다.</p>
            </div>
          </div>
        </div>
      </div>
      
      <main className="main-content">
        <div className="forms-container">
          <section className="form-card publish-section">
            <h2>정보 게시하기</h2>
            <p className="section-description">공익 목적의 정보를 블록체인에 게시합니다. 최소 0.01 ETH부터 게시 가능하며, 높은 금액 순으로 상단에 표시됩니다.</p>
            <form onSubmit={handlePublishPost}>
              <div className="form-group">
                <label>제목:</label>
                <input 
                  type="text" 
                  name="title" 
                  value={formData.title} 
                  onChange={handleInputChange} 
                  placeholder="정보의 제목을 입력하세요"
                  required 
                />
              </div>
              
              <div className="form-group">
                <label>내용:</label>
                <textarea 
                  name="content" 
                  value={formData.content} 
                  onChange={handleInputChange}
                  placeholder="공개할 정보 내용을 입력하세요"
                  required 
                />
              </div>
              
              <div className="form-group">
                <label>관련 링크:</label>
                <input 
                  type="url" 
                  name="link" 
                  value={formData.link} 
                  onChange={handleInputChange}
                  placeholder="관련 정보 링크 (선택사항)"
                />
              </div>
              
              <div className="form-group">
                <label>게시 비용 (ETH):</label>
                <div className="input-with-info">
                  <input 
                    type="number" 
                    name="fee" 
                    min="0.01" 
                    step="0.01" 
                    value={formData.fee} 
                    onChange={handleInputChange} 
                    required 
                  />
                  <div className="input-info">최소 0.01 ETH, 높은 금액일수록 상단에 표시</div>
                </div>
              </div>
              
              <button type="submit" className="button-primary">게시하기</button>
            </form>
          </section>
          
          <div className="management-forms">
            <section className="form-card remove-section">
              <h2>정보 삭제하기</h2>
              <p className="section-description">게시물을 삭제하려면 게시 비용의 2배를 지불해야 합니다. 관리자에게 지불 시 작성자는 1년 후 무상 재게시 가능합니다.</p>
              <form onSubmit={handleRemovePost}>
                <div className="form-group">
                  <label>게시물 ID:</label>
                  <input 
                    type="number" 
                    value={removePostId} 
                    onChange={(e) => setRemovePostId(e.target.value)}
                    placeholder="삭제할 게시물 ID" 
                    required 
                  />
                </div>
                
                <div className="form-group">
                  <label>수령인 (작성자 또는 관리자 주소):</label>
                  <input 
                    type="text" 
                    value={paymentReceiver} 
                    onChange={(e) => setPaymentReceiver(e.target.value)}
                    placeholder="이더리움 주소" 
                    required 
                  />
                </div>
                
                <div className="form-group">
                  <label>삭제 비용 (ETH):</label>
                  <div className="input-with-info">
                    <input 
                      type="number" 
                      min="0.01" 
                      step="0.01" 
                      value={removeFee} 
                      onChange={(e) => setRemoveFee(e.target.value)}
                      placeholder="게시 비용의 2배" 
                      required 
                    />
                    <div className="input-info">원래 게시 비용의 2배를 지불해야 합니다</div>
                  </div>
                </div>
                
                <button type="submit" className="button-danger">삭제하기</button>
              </form>
            </section>
            
            <section className="form-card renew-section">
              <h2>정보 갱신하기</h2>
              <p className="section-description">게시 기간이 만료된 정보를 다시 게시합니다. 원래 게시 비용과 동일한 금액을 지불해야 합니다.</p>
              <form onSubmit={handleRenewPost}>
                <div className="form-group">
                  <label>게시물 ID:</label>
                  <input 
                    type="number" 
                    value={renewPostId} 
                    onChange={(e) => setRenewPostId(e.target.value)}
                    placeholder="갱신할 게시물 ID" 
                    required 
                  />
                </div>
                
                <div className="form-group">
                  <label>갱신 비용 (ETH):</label>
                  <div className="input-with-info">
                    <input 
                      type="number" 
                      min="0.01" 
                      step="0.01" 
                      value={renewFee} 
                      onChange={(e) => setRenewFee(e.target.value)}
                      placeholder="원래 게시 비용과 동일" 
                      required 
                    />
                    <div className="input-info">원래 게시 비용과 동일한 금액이 필요합니다</div>
                  </div>
                </div>
                
                <button type="submit" className="button-secondary">갱신하기</button>
              </form>
            </section>
          </div>
        </div>
        
        <section className="posts-section">
          <div className="section-header">
            <h2>공개된 정보 목록</h2>
            <p className="section-description">게시 비용이 높은 정보가 상단에 표시됩니다. 후원 기능을 통해 작성자에게 직접 이더를 보낼 수 있습니다.</p>
          </div>
          
          {loading ? (
            <div className="loading-container">
              <div className="loading-spinner"></div>
              <p>정보를 불러오는 중입니다...</p>
            </div>
          ) : (
            <>
              {posts.length === 0 ? (
                <div className="empty-state">
                  <p>현재 게시된 정보가 없습니다.</p>
                  <p className="sub-message">첫 번째 정보를 게시해 보세요!</p>
                </div>
              ) : (
                <div className="posts-grid">
                  {posts.map((post) => (
                    <div key={post.id} className="post-card">
                      <div className="post-header">
                        <span className="post-id">ID: {post.id}</span>
                        <span className="post-fee">{post.publicationFee} ETH</span>
                      </div>
                      <h3 className="post-title">{post.title}</h3>
                      <div className="post-content-wrapper">
                        <p className="post-content">{post.content}</p>
                      </div>
                      {post.link && (
                        <div className="post-link">
                          <a href={post.link} target="_blank" rel="noopener noreferrer">
                            관련 링크 보기
                          </a>
                        </div>
                      )}
                      <div className="post-meta">
                        <div className="post-author">
                          <span className="meta-label">작성자:</span>
                          <span className="meta-value" title={post.author}>{shortenAddress(post.author)}</span>
                        </div>
                        <div className="post-expiry">
                          <span className="meta-label">만료일:</span>
                          <span className="meta-value">{post.expiryTime}</span>
                        </div>
                      </div>
                      <div className="post-actions">
                        <button 
                          className="donate-button"
                          onClick={() => {
                            const amount = prompt("후원할 금액을 ETH 단위로 입력하세요:");
                            if (amount) {
                              donateToAuthor(post.author, amount);
                            }
                          }}
                        >
                          작성자에게 후원하기
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              
              {totalPages > 1 && (
                <div className="pagination">
                  <button 
                    className="pagination-button"
                    onClick={() => handlePageChange(Math.max(0, currentPage - 1))}
                    disabled={currentPage === 0}
                  >
                    이전 페이지
                  </button>
                  <span className="pagination-info">페이지 {currentPage + 1} / {totalPages}</span>
                  <button 
                    className="pagination-button"
                    onClick={() => handlePageChange(Math.min(totalPages - 1, currentPage + 1))}
                    disabled={currentPage === totalPages - 1}
                  >
                    다음 페이지
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </main>
      
      <footer className="app-footer">
        <div className="footer-content">
          <p>&copy; 2025 공익 정보 공개 플랫폼 | <a href="https://github.com/etherNews/public-disclosure-contract" target="_blank" rel="noopener noreferrer">GitHub</a></p>
          <p className="footer-disclaimer">이 플랫폼은 이더리움 블록체인에 기반하여 분산화된 정보 공개를 제공합니다. 모든 거래는 블록체인에 영구적으로 기록됩니다.</p>
        </div>
      </footer>
    </div>
  );
}

export default App;