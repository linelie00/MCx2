import '../Styles/World.css';
import imgMonster from '../Assets/Images/img_monster.webp';
import J4Wphoto from '../Assets/Images/img_J4Wphoto.webp';
import imgZetta from '../Assets/Images/img_zetta.webp';
import imgCrow from '../Assets/Images/img_crow.webp';

const World = () => {
    return (
        <div className="world-content">
            <div className="article">
                <div className="article-header">
                    <div className="header-box left-box">
                        <span className="header-label">The Return of</span>
                        <span className="header-label">the Berry Keepers</span>
                    </div>
                    <h2>World</h2>
                    <div className="header-box right-box">
                        <span className="header-label">No contact with the capital, Lil'laign?!</span>
                        <span className='header-details'>Dependence, is facing severe difficulties due to a shortage of supplies...</span>
                    </div>
                </div>
                <div className="headline-divider">
                    <span className="byname">No.38</span>
                    <span className="byname">Written by @GoN4N_</span>
                    <span className="byname">and @childofwinter_,@eollaeveollae</span>
                </div>
                <div className="article-body">
                    <img src={imgMonster} className="article-image" />
                    <p className="body-label">마물,</p>
                    <span className="body-text">그들은 땅에서 솟아나는 정체 불명의 생명체입니다. 같은 마물을 제외한 모든 것을 닥치는 대로 공격하며, 죽이면 먼지로 변했다가 일주일 뒤 같은 곳에서 땅을 뚫고 되살아납니다. 오랜 시간이 지나 자연사하게 되면 다시는 나타나지 않습니다.<br/>
                    아주 오래 전부터 그들의 흔적은 역사서 등지에 기록되어 왔으나 그들이 평범한 민간인들에게도 자주 발견되기 시작한 것은 20년 전부터 입니다.<br/>
                    죽여도 다시 부활하는 마물들의 특성 덕에 그들은 해가 갈수록 수가 불어났고, 결국 지금으로부터 5년 전 즈음의 시점에서는 수도 외 지역엔 인간보다 마물이 더 많다는 것이 정설이 되었습니다.<br/>
                    이 어지러운 형국에 마물에 의해 희생되는 자들은 점점 늘어나며 실종되어 버리는 사람은 이제 수를 셀 수 없을 지경입니다. 제대로 된 경비를 갖추지 못한 마을들은 모조리 습격당해 살아남은 이들의 대다수가 수도나 그나마 안전한 마을로 이주했습니다. 덕분에 어느 곳에서나 형편은 어렵다고들 합니다.<br/>
                    하지만 이런 형국에도 모험심을 잊지 못해 여기저기 찔러보고 다니는 종자들은 여전히 존재했으니···<br/>
                    </span>
                    <p className="body-label">베리 파수꾼 Berry Keepers</p>
                    <div className="article-zetta-image">
                        <img src={imgZetta}/>
                        <span className="body-text">~단장, 제타~</span>
                        <span className="body-Comment">“ 따라와, 내가 길을 열어주겠다! ”</span>
                    </div>
                    <span className="body-text">그렇습니다, 바로 여러분이 속해 있는 모험단, 베리 파수꾼단입니다.<br/>
                    이들은 온 세상을 돌아다니며 머무는 곳에서 일을 돕거나, 마물을 물리쳐주거나, 노숙을 하거나, 노숙을 하거나, 노숙을 하거나··· 하지만, 새로운 곳을 탐험하려는 처음의 그 목적만큼은 잊지 않았습니다. 이 넓은 세상, 발을 디디지 않은 곳이 없게 하겠다는 목적이죠. 덕분에 단원들의 출신도 다양합니다.<br/>
                    그렇게 시작했던 모험단은 어느 새 결성된 지 9년이나 지난 어엿한 베테랑 모험단이 되었습니다. 곧 결성 10 주년을 맞이하겠네요.<br/>
                    그렇게 오랜 기간 쌓아온 경험 덕분에 사실 꽤나 강한 집단이 되었습니다. 지금에 와서 이들만큼 오래 밖에서 야영하며 또 무사히 돌아올 수 있는 단체는 군대가 아니면 거의 찾아볼 수 없을테죠. 단원들 모두에게는 사망 방지 마법이 걸려 있어 이게 무사히 돌아오는 비결이 되기도 합니다.<br/>
                    그렇지만··· 그 대단함을 알아주는 사람들은 소수에 불과합니다. 늘 조금 궁핍한 생활을 하는 것도 평판에 그닥 도움이 되지 않았습니다. 애초에 단명도 들판에 널린 산딸기만 따먹으며 노숙한다는 의미로 지어진 별명이었다죠?<br/>
                    하지만 이들의 존속도 현재로서는 위기에 처해있습니다. 모험이 너무 위험해진 것이죠. 크게 다치고 은퇴하는 단원들도 많이 늘어났습니다. 지금 남은 건··· 살아남을 만큼 강하거나 그럼에도 모험을 포기할 수 없는 사람들 뿐입니다.<br/>
                    </span>
                    <img src={J4Wphoto} className="article-photo-image" />
                    <img src={imgCrow} className="article-berry-image" />
                    <p className="body-label">도입</p>
                    <span className="body-text">몇 개월 전 부터 이웃 수도 릴레인에서의 모든 연락이 끊겼다. 릴레인과 물자를 교류하며 겨우겨우 살아가던 수도 디펜덴스는 크게 곤란해 하고 있다.  군대, 용병, 까마귀··· 그 모든 수단을 동원해가며 릴레인에게 어떤 일이 생겼는지 알아내려 했으나 모두 돌아오는 일은 없었다. 어떤 일이 있어도 길을 찾아서 편지를 전하는 까마귀조차 그 깃털 하나 보이지 않았다!<br/>
                    마물의 움직임이 더욱 거세진 지금 수도를 호위할 병력도 부족하다. 그러면서도 디펜덴스로 이주하는 사람은 많아져, 부족해진 살림탓에 범죄에 손을 대는 부도덕한 일당 또한 늘어났기에 수도의 처지는 갈수록 힘들어지고만 있다.<br/>
                    그리고···<br/>
                    우리의 모험단은 기나긴 모험을 마치고 수도 디펜덴스에 며칠 머물렀다. 그러던 중, 마물이 득시글 거리는 개척되지 않은 곳도 앞장서 탐험한다는 우리의 소문이 디펜덴스의 주요 인사들에게 닿았고 수도에서는 제안을 해 왔다. 저 밖에 나가 수도 릴레인이 어떤 상태인지 확인하고 돌아와준다면 디펜덴스에서 모험단에게 크게 보상을 해 줄 것이라는 말이다. 확인만 하고 돌아오라니, 최고의 조건 아닌가? 수도에 직접적인 도움이 된다면 모험단의 평판도 개선될 것이다. 우리의 단장 제타는 곧바로 제안을 받아들였고 디펜덴스에서 지원해준 지참금을 받아 릴레인을 향한 모험에 나선다···<br/>
                    </span>
                    <p className="body-label">모험의 시작</p>
                    <span className="body-text">여러가지 사정을 듣고, 새로운 모험단원도 모집하고··· 그렇게 수도 디펜덴스를 떠나 모험을 시작한지 3일, 모험단은 수도 바깥 모험가들의 주점 “이니트”에 도착했다.
                    새로 들어온 얼굴들과 익숙해지는 자리도 가질 겸 이번 모험을 축하하고, 언제나와 같이 무사 귀환을 바라자는 의미로 즐겁게 먹고 마시는 자리를 가질 것이다··
                    </span>
                </div>
            </div>
        </div>

    );
} 

export default World;